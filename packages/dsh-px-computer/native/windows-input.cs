// Bounded foreground input with a separate guardian. No scripts, global hooks or persistent held keys.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public sealed class InputPlan {
    public int pid;
    public long window_id;
    public int[] keys;
    public string[] buttons;
    public int duration_ms;
    public int dx;
    public int dy;
}

[ComImport, Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IVirtualDesktopManager {
    [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr window, [MarshalAs(UnmanagedType.Bool)] out bool current);
    [PreserveSig] int GetWindowDesktopId(IntPtr window, out Guid desktop);
    [PreserveSig] int MoveWindowToDesktop(IntPtr window, ref Guid desktop);
}

internal static class WindowsInput {
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput {
        public int dx, dy;
        public uint mouseData, flags, time;
        public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Sequential)] private struct KeyInput {
        public ushort key, scan;
        public uint flags, time;
        public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Explicit)] private struct InputData {
        [FieldOffset(0)] public MouseInput mouse;
        [FieldOffset(0)] public KeyInput key;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Input {
        public uint type;
        public InputData data;
    }
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint key, uint mode);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);

    private static int Inspect(int expectedPid, long windowId) {
        var window = new IntPtr(windowId); uint owner;
        if (!IsWindow(window) || GetWindowThreadProcessId(window, out owner) == 0 || owner != expectedPid)
            throw new InvalidOperationException("Target window changed");
        bool? current = null; int cloaked;
        int result = DwmGetWindowAttribute(window, 14, out cloaked, 4);
        object manager = null;
        try {
            manager = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a")));
            bool value;
            if (((IVirtualDesktopManager)manager).IsWindowOnCurrentVirtualDesktop(window, out value) == 0) current = value;
        } catch { } finally { if (manager != null) Marshal.ReleaseComObject(manager); }
        var foreground = GetForegroundWindow();
        Emit(new { pid = expectedPid, window_id = windowId, foreground = foreground == window, foreground_window_id = foreground.ToInt64(),
            current_desktop = current, cloaked = result == 0 ? (int?)cloaked : null, bounds = WindowsView.Bounds(window), input_state = WindowsView.InputState(window) });
        return 0;
    }

    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly UIntPtr Marker = new UIntPtr(0x50584355);

    private static void Emit(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
    private static void Inject(Input input) {
        if (SendInput(1, new Input[] { input }, Marshal.SizeOf(typeof(Input))) != 1)
            throw new InvalidOperationException("SendInput failed: " + Marshal.GetLastWin32Error());
    }
    private static void Key(int key, bool up) {
        bool extended = key >= 33 && key <= 46;
        Inject(new Input { type = 1, data = new InputData { key = new KeyInput {
            scan = (ushort)MapVirtualKey((uint)key, 0), flags = 8u | (up ? 2u : 0u) | (extended ? 1u : 0u), extra = Marker
        } } });
    }
    private static int ButtonKey(string button) {
        if (button == "left") return 1;
        if (button == "right") return 2;
        if (button == "middle") return 4;
        throw new ArgumentException("Unsupported mouse button");
    }
    private static void Button(string button, bool up) {
        uint flag = button == "left" ? (up ? 4u : 2u) : button == "right" ? (up ? 16u : 8u) : (up ? 64u : 32u);
        Inject(new Input { type = 0, data = new InputData { mouse = new MouseInput { flags = flag, extra = Marker } } });
    }
    private static void Move(int dx, int dy) {
        if (dx == 0 && dy == 0) return;
        Inject(new Input { type = 0, data = new InputData { mouse = new MouseInput {
            dx = dx, dy = dy, flags = 0x2001, extra = Marker
        } } });
    }
    private static void Validate(InputPlan plan) {
        if (plan == null || plan.pid <= 0 || plan.window_id <= 0 || plan.duration_ms < 10 || plan.duration_ms > 10000 ||
            Math.Abs((long)plan.dx) > 2000 || Math.Abs((long)plan.dy) > 2000)
            throw new ArgumentException("Invalid bounded input plan");
        plan.keys = plan.keys ?? new int[0]; plan.buttons = plan.buttons ?? new string[0];
        if (plan.keys.Length > 6 || plan.buttons.Length > 2) throw new ArgumentException("Too many held inputs");
        var keys = new HashSet<int>();
        foreach (int key in plan.keys) {
            // Text, navigation, modifiers and function keys only; no Windows key, shell or media commands.
            bool valid = key == 8 || key == 9 || key == 13 || key == 16 || key == 17 || key == 18 || key == 27 ||
                (key >= 32 && key <= 40) || key == 45 || key == 46 || (key >= 48 && key <= 57) ||
                (key >= 65 && key <= 90) || (key >= 112 && key <= 123);
            if (!valid || !keys.Add(key)) throw new ArgumentException("Invalid or duplicate key");
        }
        if (keys.Contains(17) && keys.Contains(18) && keys.Contains(46)) throw new ArgumentException("Secure attention is forbidden");
        var buttons = new HashSet<string>();
        foreach (string button in plan.buttons) { ButtonKey(button); if (!buttons.Add(button)) throw new ArgumentException("Duplicate button"); }
        if (plan.keys.Length == 0 && plan.buttons.Length == 0 && plan.dx == 0 && plan.dy == 0)
            throw new ArgumentException("Empty input plan");
    }
    private static void Target(InputPlan plan) {
        var window = new IntPtr(plan.window_id); uint owner;
        if (!IsWindow(window) || GetWindowThreadProcessId(window, out owner) == 0 || owner != plan.pid)
            throw new InvalidOperationException("Target window changed");
        if (GetForegroundWindow() != window) throw new InvalidOperationException("Target lost foreground; input stopped");
    }
    private static void Release(string token) {
        if (token.StartsWith("K:")) Key(int.Parse(token.Substring(2)), true);
        else if (token.StartsWith("B:")) Button(token.Substring(2), true);
    }
    private static bool Alive(Process process) { try { return !process.HasExited; } catch { return false; } }

    private static int Execute(InputPlan plan, int guardianPid, int hostPid) {
        var held = new List<string>();
        string failure = null;
        var clock = Stopwatch.StartNew();
        using (var guardian = Process.GetProcessById(guardianPid))
        using (var host = Process.GetProcessById(hostPid)) {
            try {
                Target(plan);
                foreach (int modifier in new int[] { 16, 17, 18, 91, 92 })
                    if ((GetAsyncKeyState(modifier) & 0x8000) != 0) throw new InvalidOperationException("A user modifier is held; input did not start");
                if (plan.buttons.Length > 0 || plan.dx != 0 || plan.dy != 0) {
                    Point pointer;
                    if (!GetCursorPos(out pointer)) throw new InvalidOperationException("Pointer position unavailable; input did not start");
                    if (GetAncestor(WindowFromPoint(pointer), 2) != new IntPtr(plan.window_id))
                        throw new InvalidOperationException("Pointer is outside the target window; observe and position it before pointer input. " + WindowsView.PointDiagnostic(pointer.x, pointer.y));
                    foreach (int button in new int[] { 1, 2, 4 })
                        if ((GetAsyncKeyState(button) & 0x8000) != 0) throw new InvalidOperationException("A user mouse button is held; pointer input did not start");
                }
                foreach (int key in plan.keys) if ((GetAsyncKeyState(key) & 0x8000) != 0) throw new InvalidOperationException("A requested key is already held by the user");
                foreach (string button in plan.buttons) if ((GetAsyncKeyState(ButtonKey(button)) & 0x8000) != 0) throw new InvalidOperationException("A requested mouse button is already held by the user");
                foreach (int key in plan.keys) {
                    Target(plan);
                    string token = "K:" + key;
                    held.Add(token); Emit(new { held = token }); // Register before injection so the guardian covers a crash between these operations.
                    Key(key, false);
                }
                foreach (string button in plan.buttons) {
                    Target(plan);
                    string token = "B:" + button;
                    held.Add(token); Emit(new { held = token }); Button(button, false);
                }
                clock.Restart();
                int sentX = 0, sentY = 0;
                do {
                    if (!Alive(guardian) || !Alive(host)) throw new InvalidOperationException("Input owner disconnected");
                    Target(plan);
                    if (Array.IndexOf(plan.keys, 27) < 0 && (GetAsyncKeyState(27) & 0x8000) != 0)
                        throw new InvalidOperationException("Escape interrupted bounded input");
                    double fraction = Math.Min(1.0, clock.Elapsed.TotalMilliseconds / plan.duration_ms);
                    int x = (int)Math.Round(plan.dx * fraction), y = (int)Math.Round(plan.dy * fraction);
                    Move(x - sentX, y - sentY); sentX = x; sentY = y;
                    if (fraction >= 1) break;
                    Thread.Sleep(10);
                } while (true);
            } catch (Exception error) { failure = error.Message; }
            finally {
                for (int i = held.Count - 1; i >= 0; i--) {
                    try { Release(held[i]); Emit(new { released = held[i] }); }
                    catch (Exception error) { failure = "Input release failed: " + error.Message; }
                }
            }
        }
        Emit(new { finished = true, ok = failure == null, error = failure, elapsed_ms = clock.ElapsedMilliseconds });
        return failure == null ? 0 : 1;
    }

    private static int Guard(InputPlan plan, string encoded, int hostPid) {
        // The owner records this guardian's PID before acknowledging. EOF means no input may start.
        if (Console.ReadLine() != "start") throw new InvalidOperationException("Input start was not acknowledged");
        var held = new HashSet<string>();
        var expected = new HashSet<string>();
        foreach (int key in plan.keys) expected.Add("K:" + key);
        foreach (string button in plan.buttons) expected.Add("B:" + button);
        var start = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,
            "--execute " + Process.GetCurrentProcess().Id + " " + hostPid + " " + encoded) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        string error = null; bool completed = false; long elapsed = 0;
        using (var host = Process.GetProcessById(hostPid))
        using (var child = Process.Start(start)) {
            Emit(new { worker_pid = child.Id });
            var watchdog = new Thread(() => {
                var clock = Stopwatch.StartNew();
                while (Alive(child)) {
                    if (!Alive(host) || clock.ElapsedMilliseconds > plan.duration_ms + 4000) { try { child.Kill(); } catch { } return; }
                    Thread.Sleep(20);
                }
            });
            watchdog.IsBackground = true; watchdog.Start();
            try {
                string line;
                while ((line = child.StandardOutput.ReadLine()) != null) {
                    var item = Json.Deserialize<Dictionary<string, object>>(line);
                    object value;
                    if (item.TryGetValue("held", out value)) {
                        string token = (string)value;
                        if (!expected.Contains(token)) throw new InvalidOperationException("Unexpected held input");
                        held.Add(token);
                    }
                    if (item.TryGetValue("released", out value)) held.Remove((string)value);
                    if (item.ContainsKey("finished")) {
                        completed = (bool)item["ok"];
                        error = item["error"] as string;
                        elapsed = Convert.ToInt64(item["elapsed_ms"]);
                    }
                }
                child.WaitForExit();
                if (child.ExitCode != 0 || !completed) error = error ?? "Input worker stopped before completion";
            } catch (Exception caught) { error = caught.Message; try { child.Kill(); child.WaitForExit(1000); } catch { } }
            finally {
                foreach (string token in held) {
                    try { Release(token); } catch (Exception caught) { error = "Guardian release failed: " + caught.Message; }
                }
            }
        }
        Emit(new { finished = true, ok = completed && error == null, error = error, elapsed_ms = elapsed, release_attempted = true });
        return completed && error == null ? 0 : 1;
    }

    [STAThread] private static int Main(string[] args) {
        try {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
            if (args.Length == 3 && args[0] == "--magnify") { Emit(WindowsView.Magnify(args[1], args[2])); return 0; }
            if (args.Length == 2 && (args[0] == "--pointer" || args[0] == "--point")) {
                if (args[1].Length > 8192) throw new ArgumentException("Pointer request too large");
                var request = Json.Deserialize<PointerRequest>(Encoding.UTF8.GetString(Convert.FromBase64String(args[1])));
                Emit(args[0] == "--point" ? WindowsView.CheckPoint(request) : WindowsView.MovePointer(request));
                return 0;
            }
            if (args.Length == 1 && args[0] == "--foreground") { Emit(new { window_id = GetForegroundWindow().ToInt64() }); return 0; }
            if (args.Length == 3 && args[0] == "--controls") {
                using (var deadline = new Timer(_ => Environment.Exit(3), null, 6000, Timeout.Infinite))
                    Emit(WindowsControls.Observe(int.Parse(args[1]), long.Parse(args[2])));
                return 0;
            }
            if (args.Length == 2 && args[0] == "--control") {
                if (args[1].Length > 49152) throw new ArgumentException("Control request too large");
                var request = Json.Deserialize<ControlRequest>(Encoding.UTF8.GetString(Convert.FromBase64String(args[1])));
                using (var deadline = new Timer(_ => Environment.Exit(3), null, 4000, Timeout.Infinite)) Emit(WindowsControls.Act(request));
                return 0;
            }
            if (args.Length == 3 && args[0] == "--inspect") {
                using (var deadline = new Timer(_ => Environment.Exit(3), null, 4000, Timeout.Infinite))
                    return Inspect(int.Parse(args[1]), long.Parse(args[2]));
            }
            if (args.Length != 3 && args.Length != 4) throw new ArgumentException("Invalid invocation");
            string encoded = args[args.Length - 1];
            if (encoded.Length > 8192) throw new ArgumentException("Input plan too large");
            var plan = Json.Deserialize<InputPlan>(Encoding.UTF8.GetString(Convert.FromBase64String(encoded)));
            Validate(plan);
            if (args[0] == "--execute" && args.Length == 4) return Execute(plan, int.Parse(args[1]), int.Parse(args[2]));
            if (args[0] == "--guard" && args.Length == 3) return Guard(plan, encoded, int.Parse(args[1]));
            throw new ArgumentException("Unknown operation");
        } catch (Exception error) { Emit(new { finished = true, ok = false, error = error.Message, code = error is NativeControlForegroundChanged ? "unexpected_foreground" : null, release_attempted = false }); return 1; }
    }
}
