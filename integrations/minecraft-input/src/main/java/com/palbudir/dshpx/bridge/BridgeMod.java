package com.palbudir.dshpx.bridge;

import com.google.gson.*;
import com.mojang.blaze3d.platform.InputConstants;
import com.sun.net.httpserver.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import javax.imageio.ImageIO;
import net.fabricmc.api.ClientModInitializer;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonInfo;
import org.lwjgl.sdl.SDLHints;
import org.lwjgl.sdl.SDLKeyboard;
import org.lwjgl.sdl.SDLKeycode;

/**
 * Optional process-local input. No world-state queries, commands, path finding or script execution.
 */
public final class BridgeMod implements ClientModInitializer {
  private static final Gson JSON = new Gson();
  private static final String INSTANCE = UUID.randomUUID().toString();
  private static final Set<String> KEYS =
      Set.of(
          "W",
          "A",
          "S",
          "D",
          "E",
          "Q",
          "R",
          "T",
          "F",
          "G",
          "C",
          "V",
          "X",
          "Z",
          "SPACE",
          "LSHIFT",
          "LCONTROL",
          "ESCAPE",
          "RETURN",
          "TAB",
          "BACKSPACE",
          "UP",
          "DOWN",
          "LEFT",
          "RIGHT",
          "F1",
          "F3",
          "F5",
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9");
  private static String lease;
  private static long leaseDeadline;
  private static Action active;
  private static boolean releaseFailed;
  private static double pointerX = 320, pointerY = 180;
  private static volatile boolean initialized;
  private static HttpServer server;
  private static ExecutorService executor;
  private static boolean configured;
  private static Path descriptor;
  private static String frameId;
  private static Object frameScreen;
  private static int frameWidth, frameHeight;
  private static long frameDeadline;
  private static final LinkedHashSet<String> requests = new LinkedHashSet<>();
  private static final AtomicBoolean screenshotBusy = new AtomicBoolean();
  private static final AtomicReference<Runnable> pendingCapture = new AtomicReference<>();

  @Override
  public void onInitializeClient() {
    if (!VirtualInput.ISOLATED) return;
    SDLHints.SDL_SetHint(SDLHints.SDL_HINT_WINDOW_ACTIVATE_WHEN_SHOWN, "0");
    byte[] secret = new byte[32];
    new SecureRandom().nextBytes(secret);
    String token = HexFormat.of().formatHex(secret);
    try {
      server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 8);
      int port = server.getAddress().getPort();
      executor =
          new ThreadPoolExecutor(
              4,
              4,
              0,
              TimeUnit.SECONDS,
              new ArrayBlockingQueue<>(8),
              task -> {
                Thread t = new Thread(task, "px-input-http");
                t.setDaemon(true);
                return t;
              },
              new ThreadPoolExecutor.AbortPolicy());
      server.setExecutor(executor);
      server.createContext("/", exchange -> handle(exchange, token, port));
      server.start();
      initialized = true;
      publish(token, port);
      Runtime.getRuntime()
          .addShutdownHook(
              new Thread(
                  () -> {
                    if (server != null) server.stop(0);
                    removeDescriptor();
                  }));
    } catch (IOException e) {
      initialized = false;
      if (server != null) server.stop(0);
      if (executor != null) executor.shutdownNow();
      removeDescriptor();
      throw new IllegalStateException("Input bridge could not start", e);
    }
  }

  private static void publish(String token, int port) throws IOException {
    String local = System.getenv("LOCALAPPDATA");
    if (local == null) throw new IOException("Windows LOCALAPPDATA is required");
    Path directory = Path.of(local, "DSH-PX", "input-bridges");
    Files.createDirectories(directory);
    Path file = directory.resolve(INSTANCE + ".json");
    UserPrincipal owner =
        directory
            .getFileSystem()
            .getUserPrincipalLookupService()
            .lookupPrincipalByName(System.getProperty("user.name"));
    AclEntry entry =
        AclEntry.newBuilder()
            .setType(AclEntryType.ALLOW)
            .setPrincipal(owner)
            .setPermissions(EnumSet.allOf(AclEntryPermission.class))
            .build();
    FileAttribute<List<AclEntry>> acl =
        new FileAttribute<>() {
          public String name() {
            return "acl:acl";
          }

          public List<AclEntry> value() {
            return List.of(entry);
          }
        };
    Files.createFile(file, acl);
    descriptor = file;
    JsonObject data = new JsonObject();
    data.addProperty("protocol", "dsh-px-input-1");
    data.addProperty("instance", INSTANCE);
    data.addProperty("pid", ProcessHandle.current().pid());
    data.addProperty("port", port);
    data.addProperty("token", token);
    Files.writeString(
        file, JSON.toJson(data), StandardCharsets.UTF_8, StandardOpenOption.TRUNCATE_EXISTING);
  }

  private static void removeDescriptor() {
    try {
      if (descriptor != null) Files.deleteIfExists(descriptor);
    } catch (IOException ignored) {
    }
  }

  private static void handle(HttpExchange x, String token, int port) throws IOException {
    try {
      String host = x.getRequestHeaders().getFirst("Host"),
          origin = x.getRequestHeaders().getFirst("Origin");
      String authorization = x.getRequestHeaders().getFirst("Authorization");
      if (!x.getRemoteAddress().getAddress().isLoopbackAddress()
          || origin != null
          || !("127.0.0.1:" + port).equals(host)
          || authorization == null
          || !MessageDigest.isEqual(
              authorization.getBytes(StandardCharsets.UTF_8),
              ("Bearer " + token).getBytes(StandardCharsets.UTF_8))) {
        reply(
            x,
            403,
            "application/json",
            "{\"error\":\"unauthorized\"}".getBytes(StandardCharsets.UTF_8));
        return;
      }
      String route = x.getRequestURI().getPath(), method = x.getRequestMethod();
      if ("/observe".equals(route) && "GET".equals(method)) {
        replyJson(x, observe());
        return;
      }
      if ("/status".equals(route) && "GET".equals(method)) {
        replyJson(x, onClient(BridgeMod::status).get(5, TimeUnit.SECONDS));
        return;
      }
      if (!"POST".equals(method)
          || !Set.of("/lease", "/heartbeat", "/input", "/release").contains(route)) {
        reply(
            x,
            404,
            "application/json",
            "{\"error\":\"unknown endpoint\"}".getBytes(StandardCharsets.UTF_8));
        return;
      }
      if (!"application/json".equals(x.getRequestHeaders().getFirst("Content-Type")))
        throw new IllegalArgumentException("JSON required");
      byte[] bytes = x.getRequestBody().readNBytes(8193);
      if (bytes.length > 8192) throw new IllegalArgumentException("Request too large");
      JsonObject body =
          JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8)).getAsJsonObject();
      if ("/input".equals(route)) {
        CompletableFuture<JsonObject> result = new CompletableFuture<>();
        long queuedAt = System.nanoTime();
        Minecraft.getInstance()
            .execute(
                () -> {
                  try {
                    if (result.isDone()
                        || System.nanoTime() - queuedAt > TimeUnit.SECONDS.toNanos(2))
                      throw new IllegalStateException("Queued input expired");
                    start(body, result);
                  } catch (Throwable e) {
                    result.completeExceptionally(e);
                  }
                });
        try {
          replyJson(x, result.get(15, TimeUnit.SECONDS));
        } finally {
          result.cancel(false);
        }
      } else replyJson(x, onClient(() -> control(route, body)).get(5, TimeUnit.SECONDS));
    } catch (Throwable error) {
      Throwable cause =
          error instanceof ExecutionException && error.getCause() != null
              ? error.getCause()
              : error;
      JsonObject response = new JsonObject();
      response.addProperty(
          "error",
          cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage());
      reply(x, 400, "application/json", JSON.toJson(response).getBytes(StandardCharsets.UTF_8));
    } finally {
      x.close();
    }
  }

  private static void reply(HttpExchange x, int code, String type, byte[] bytes)
      throws IOException {
    x.getResponseHeaders().set("Content-Type", type);
    x.getResponseHeaders().set("Cache-Control", "no-store");
    x.sendResponseHeaders(code, bytes.length);
    x.getResponseBody().write(bytes);
  }

  private static void replyJson(HttpExchange x, JsonObject body) throws IOException {
    reply(x, 200, "application/json", JSON.toJson(body).getBytes(StandardCharsets.UTF_8));
  }

  private static <T> CompletableFuture<T> onClient(Callable<T> action) {
    CompletableFuture<T> f = new CompletableFuture<>();
    long queuedAt = System.nanoTime();
    Minecraft.getInstance()
        .execute(
            () -> {
              try {
                if (System.nanoTime() - queuedAt > TimeUnit.SECONDS.toNanos(4))
                  throw new IllegalStateException("Client request expired");
                f.complete(action.call());
              } catch (Throwable e) {
                f.completeExceptionally(e);
              }
            });
    return f;
  }

  private static JsonObject status() {
    Minecraft mc = Minecraft.getInstance();
    JsonObject s = new JsonObject();
    s.addProperty("protocol", "dsh-px-input-1");
    s.addProperty("application", "Minecraft 26.3");
    s.addProperty("instance", INSTANCE);
    s.addProperty("pid", ProcessHandle.current().pid());
    s.addProperty("isolated", VirtualInput.ISOLATED);
    s.addProperty("virtual_capture", mc.mouseHandler.isMouseGrabbed());
    s.addProperty("input_width", mc.getWindow().getScreenWidth());
    s.addProperty("input_height", mc.getWindow().getScreenHeight());
    s.addProperty("pointer_x", pointerX);
    s.addProperty("pointer_y", pointerY);
    s.addProperty("active", active != null);
    s.addProperty("release_failed", releaseFailed);
    s.add("held_keys", JSON.toJsonTree(VirtualInput.KEYS));
    s.add("held_buttons", JSON.toJsonTree(VirtualInput.BUTTONS));
    s.addProperty("suppressed_native_callbacks", VirtualInput.SUPPRESSED.get());
    s.addProperty("native_left_pressed", mc.mouseHandler.isLeftPressed());
    s.addProperty("native_forward_pressed", mc.options.keyUp.isDown());
    s.addProperty("native_attack_pressed", mc.options.keyAttack.isDown());
    return s;
  }

  private static int modifiers() {
    int mods = 0;
    if (VirtualInput.KEYS.contains(InputConstants.KEY_LSHIFT)) mods |= SDLKeycode.SDL_KMOD_LSHIFT;
    if (VirtualInput.KEYS.contains(InputConstants.KEY_LCONTROL)) mods |= SDLKeycode.SDL_KMOD_LCTRL;
    return mods;
  }

  private static KeyEvent keyEvent(int key) {
    int mods = modifiers();
    return new KeyEvent(key, SDLKeyboard.SDL_GetKeyFromScancode(key, (short) mods, true), mods);
  }

  private static JsonObject control(String route, JsonObject body) {
    if ("/lease".equals(route)) {
      expire();
      if (lease != null) throw new IllegalStateException("Control lease already held");
      lease = UUID.randomUUID().toString();
      leaseDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
      JsonObject s = status();
      s.addProperty("lease", lease);
      return s;
    }
    requireLease(body);
    if ("/release".equals(route)) {
      finish("Control released");
      lease = null;
    } else leaseDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
    return status();
  }

  private static void requireLease(JsonObject body) {
    expire();
    if (lease == null || !body.has("lease") || !lease.equals(body.get("lease").getAsString()))
      throw new IllegalStateException("Control lease expired");
  }

  private static void expire() {
    if (lease != null && System.nanoTime() > leaseDeadline) {
      finish("Control heartbeat expired");
      lease = null;
    }
  }

  private static int integer(JsonObject b, String key, int fallback, int min, int max) {
    if (!b.has(key)) return fallback;
    double d = b.get(key).getAsDouble();
    if (!Double.isFinite(d) || d != Math.rint(d) || d < min || d > max)
      throw new IllegalArgumentException("Invalid " + key);
    return (int) d;
  }

  private static void start(JsonObject body, CompletableFuture<JsonObject> result)
      throws Exception {
    if (releaseFailed)
      throw new IllegalStateException(
          "Input release failed; restart this isolated instance before continuing");
    requireLease(body);
    if (active != null) throw new IllegalStateException("Input already active");
    for (String k : body.keySet())
      if (!Set.of(
              "lease",
              "frame_id",
              "request_id",
              "duration_ms",
              "keys",
              "buttons",
              "dx",
              "dy",
              "x",
              "y",
              "text")
          .contains(k)) throw new IllegalArgumentException("Unknown input field");
    Minecraft mc = Minecraft.getInstance();
    if (!body.has("frame_id")
        || frameId == null
        || !frameId.equals(body.get("frame_id").getAsString())
        || System.nanoTime() > frameDeadline
        || frameScreen != mc.gui.screen()
        || frameWidth != mc.getWindow().getScreenWidth()
        || frameHeight != mc.getWindow().getScreenHeight())
      throw new IllegalStateException("Observe again: frame expired or interface changed");
    String request = body.get("request_id").getAsString();
    UUID.fromString(request);
    if (!requests.add(request))
      throw new IllegalArgumentException("Input request already consumed");
    if (requests.size() > 256) requests.remove(requests.iterator().next());
    frameId = null;
    Action a = new Action();
    a.result = result;
    a.duration = integer(body, "duration_ms", 100, 10, 10000);
    a.dx = integer(body, "dx", 0, -10000, 10000);
    a.dy = integer(body, "dy", 0, -10000, 10000);
    if (body.has("keys"))
      for (JsonElement v : body.getAsJsonArray("keys")) {
        String key = v.getAsString();
        if (!KEYS.contains(key) || a.keys.size() >= 8)
          throw new IllegalArgumentException("Invalid key");
        a.keys.add(InputConstants.class.getField("KEY_" + key).getInt(null));
      }
    if (a.keys.contains(InputConstants.KEY_F3) && a.keys.contains(InputConstants.KEY_C))
      throw new IllegalArgumentException("Debug crash chord is not allowed");
    if (body.has("buttons"))
      for (JsonElement v : body.getAsJsonArray("buttons")) {
        String name = v.getAsString();
        if (!Set.of("left", "middle", "right").contains(name) || a.buttons.size() >= 3)
          throw new IllegalArgumentException("Invalid button");
        a.buttons.add(
            InputConstants.class
                .getField("MOUSE_BUTTON_" + name.toUpperCase(Locale.ROOT))
                .getInt(null));
      }
    if ((a.keys.contains(InputConstants.KEY_ESCAPE)
            || a.keys.contains(InputConstants.KEY_E)
            || a.keys.contains(InputConstants.KEY_T))
        && (a.keys.size() > 1
            || !a.buttons.isEmpty()
            || a.dx != 0
            || a.dy != 0
            || body.has("text")))
      throw new IllegalArgumentException(
          "Interface-changing keys must be sent as a separate action");
    if (body.has("x") != body.has("y"))
      throw new IllegalArgumentException("Both pointer coordinates required");
    if (body.has("x")) {
      pointerX = integer(body, "x", 0, 0, mc.getWindow().getScreenWidth() - 1);
      pointerY = integer(body, "y", 0, 0, mc.getWindow().getScreenHeight() - 1);
    }
    String text = body.has("text") ? body.get("text").getAsString() : "";
    if (text.length() > 1024 || text.chars().anyMatch(c -> Character.isISOControl(c)))
      throw new IllegalArgumentException("Invalid text");
    a.screen = mc.gui.screen();
    a.width = mc.getWindow().getScreenWidth();
    a.height = mc.getWindow().getScreenHeight();
    a.start = System.nanoTime();
    active = a;
    try {
      VirtualInput.dispatch(
          () -> {
            long handle = mc.getWindow().handle();
            if (mc.gui.screen() == null && !mc.mouseHandler.isMouseGrabbed())
              mc.mouseHandler.grabMouse();
            mc.mouseHandler.onMove(handle, pointerX, pointerY, 0, 0);
            if (interfaceChanged(a)) return;
            VirtualInput.KEYS.addAll(a.keys);
            for (int key : a.keys) {
              a.dispatchedKeys.add(key);
              mc.keyboardHandler.keyPress(handle, InputConstants.PRESS, keyEvent(key));
              if (interfaceChanged(a)) return;
            }
            for (int button : a.buttons) {
              VirtualInput.BUTTONS.add(button);
              a.dispatchedButtons.add(button);
              mc.mouseHandler.onButton(
                  handle, new MouseButtonInfo(button, modifiers()), InputConstants.PRESS);
              if (interfaceChanged(a)) return;
            }
            if (!text.isEmpty()) {
              a.textSent = true;
              mc.keyboardHandler.textInput(handle, text);
            }
          });
      if (interfaceChanged(a)) {
        a.early = true;
        finish(null);
      }
    } catch (Throwable e) {
      finish(e.toString());
    }
  }

  private static boolean interfaceChanged(Action a) {
    Minecraft mc = Minecraft.getInstance();
    return mc.gui.screen() != a.screen
        || mc.getWindow().getScreenWidth() != a.width
        || mc.getWindow().getScreenHeight() != a.height;
  }

  public static void frame() {
    if (!initialized) return;
    if (!configured) {
      Minecraft mc = Minecraft.getInstance();
      mc.options.framerateLimit().set(30);
      mc.options.renderDistance().set(6);
      mc.options.simulationDistance().set(5);
      configured = true;
    }
    expire();
    Action a = active;
    if (a == null) return;
    try {
      if (interfaceChanged(a)) {
        a.early = true;
        finish(null);
        return;
      }
      double fraction = Math.min(1.0, (System.nanoTime() - a.start) / 1_000_000.0 / a.duration);
      double dx = a.dx * fraction - a.sentX, dy = a.dy * fraction - a.sentY;
      a.sentX += dx;
      a.sentY += dy;
      Minecraft mc = Minecraft.getInstance();
      if (mc.gui.screen() != null) {
        pointerX = Math.max(0, Math.min(mc.getWindow().getScreenWidth() - 1, pointerX + dx));
        pointerY = Math.max(0, Math.min(mc.getWindow().getScreenHeight() - 1, pointerY + dy));
      }
      VirtualInput.dispatch(
          () -> mc.mouseHandler.onMove(mc.getWindow().handle(), pointerX, pointerY, dx, dy));
      if (interfaceChanged(a)) {
        a.early = true;
        finish(null);
      } else if (a.result.isCancelled()) finish("Input connection ended");
      else if (fraction >= 1) finish(null);
    } catch (Throwable e) {
      finish(e.toString());
    }
  }

  private static void finish(String error) {
    Action a = active;
    active = null;
    Minecraft mc = Minecraft.getInstance();
    List<Throwable> failures = new ArrayList<>();
    if (a != null) {
      // Modifier polling may need the whole requested chord. Undispatched keys must
      // be cleared without sending release events into a newly opened interface.
      VirtualInput.KEYS.retainAll(a.dispatchedKeys);
      VirtualInput.BUTTONS.retainAll(a.dispatchedButtons);
    }
    VirtualInput.dispatch(
        () -> {
          for (int key : Set.copyOf(VirtualInput.KEYS)) {
            VirtualInput.KEYS.remove(key);
            try {
              mc.keyboardHandler.keyPress(
                  mc.getWindow().handle(), InputConstants.RELEASE, keyEvent(key));
            } catch (Throwable e) {
              failures.add(e);
            }
          }
          for (int button : Set.copyOf(VirtualInput.BUTTONS)) {
            VirtualInput.BUTTONS.remove(button);
            try {
              mc.mouseHandler.onButton(
                  mc.getWindow().handle(),
                  new MouseButtonInfo(button, modifiers()),
                  InputConstants.RELEASE);
            } catch (Throwable e) {
              failures.add(e);
            }
          }
          try {
            KeyMapping.releaseAll();
          } catch (Throwable e) {
            failures.add(e);
          }
        });
    boolean released =
        failures.isEmpty()
            && VirtualInput.KEYS.isEmpty()
            && VirtualInput.BUTTONS.isEmpty()
            && !mc.mouseHandler.isLeftPressed()
            && !mc.options.keyUp.isDown()
            && !mc.options.keyAttack.isDown();
    if (!released) releaseFailed = true;
    if (a != null) {
      JsonObject s = status();
      s.addProperty("ok", error == null && released);
      s.addProperty("stopped_early", a.early);
      s.add("dispatched_keys", JSON.toJsonTree(a.dispatchedKeys));
      s.add("dispatched_buttons", JSON.toJsonTree(a.dispatchedButtons));
      s.addProperty("dispatched_text", a.textSent);
      if (error != null) s.addProperty("error", error);
      else if (!released) s.addProperty("error", "Virtual input release failed");
      s.addProperty("elapsed_ms", (System.nanoTime() - a.start) / 1_000_000);
      s.addProperty("released", released);
      a.result.complete(s);
    }
  }

  public static void close() {
    if (!initialized) return;
    initialized = false;
    try {
      finish("Client shutting down");
    } finally {
      lease = null;
      if (server != null) {
        server.stop(0);
        server = null;
      }
      if (executor != null) {
        executor.shutdownNow();
        executor = null;
      }
      removeDescriptor();
    }
  }

  /** Capture after rendering, not from the pre-render task queue's previous framebuffer. */
  public static void afterFrame() {
    Runnable capture = pendingCapture.getAndSet(null);
    if (capture != null) capture.run();
  }

  private static JsonObject observe() throws Exception {
    if (!screenshotBusy.compareAndSet(false, true))
      throw new IllegalStateException("Screenshot already pending");
    CompletableFuture<JsonObject> result = new CompletableFuture<>();
    Runnable capture =
        () -> {
          Minecraft mc = Minecraft.getInstance();
          Object screen = mc.gui.screen();
          int width = mc.getWindow().getScreenWidth(), height = mc.getWindow().getScreenHeight();
          try {
            Screenshot.takeScreenshot(
                mc.gameRenderer.mainRenderTarget(),
                image -> {
                  try (image) {
                    if (result.isDone()
                        || screen != mc.gui.screen()
                        || width != mc.getWindow().getScreenWidth()
                        || height != mc.getWindow().getScreenHeight())
                      throw new IllegalStateException(
                          "Interface changed while capturing; observe again");
                    if ((long) image.getWidth() * image.getHeight() > 8_294_400)
                      throw new IllegalStateException("Frame too large");
                    BufferedImage buffered =
                        new BufferedImage(
                            image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_ARGB);
                    int[] pixels = image.getPixelsABGR();
                    for (int i = 0; i < pixels.length; i++) {
                      int p = pixels[i];
                      pixels[i] = (p & 0xff00ff00) | ((p & 255) << 16) | ((p >>> 16) & 255);
                    }
                    buffered.setRGB(
                        0, 0, image.getWidth(), image.getHeight(), pixels, 0, image.getWidth());
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    ImageIO.write(buffered, "png", bytes);
                    frameId = UUID.randomUUID().toString();
                    frameScreen = screen;
                    frameWidth = width;
                    frameHeight = height;
                    frameDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
                    JsonObject s = status();
                    s.addProperty("frame_id", frameId);
                    s.addProperty("png", Base64.getEncoder().encodeToString(bytes.toByteArray()));
                    result.complete(s);
                  } catch (Throwable e) {
                    result.completeExceptionally(e);
                  } finally {
                    screenshotBusy.set(false);
                  }
                });
          } catch (Throwable e) {
            screenshotBusy.set(false);
            result.completeExceptionally(e);
          }
        };
    pendingCapture.set(capture);
    try {
      return result.get(10, TimeUnit.SECONDS);
    } finally {
      result.cancel(false);
      if (pendingCapture.compareAndSet(capture, null)) screenshotBusy.set(false);
    }
  }

  private static final class Action {
    int duration, dx, dy, width, height;
    long start;
    double sentX, sentY;
    Object screen;
    boolean early, textSent;
    final Set<Integer> keys = new LinkedHashSet<>(), buttons = new LinkedHashSet<>();
    final Set<Integer> dispatchedKeys = new LinkedHashSet<>(),
        dispatchedButtons = new LinkedHashSet<>();
    CompletableFuture<JsonObject> result;
  }
}
