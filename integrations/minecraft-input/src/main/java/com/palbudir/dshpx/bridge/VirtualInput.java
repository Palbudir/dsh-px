package com.palbudir.dshpx.bridge;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/** Process-local input only. No OS hooks, SendInput, cursor warping, or world queries. */
public final class VirtualInput {
  public static final boolean ISOLATED = Boolean.getBoolean("dsh.px.game.isolated");
  private static final ThreadLocal<Boolean> DISPATCH = ThreadLocal.withInitial(() -> false);
  public static final Set<Integer> KEYS = ConcurrentHashMap.newKeySet();
  public static final Set<Integer> BUTTONS = ConcurrentHashMap.newKeySet();
  public static final AtomicLong SUPPRESSED = new AtomicLong();
  public static volatile String clipboard = "";

  public static boolean accepts() {
    if (!ISOLATED || DISPATCH.get()) return true;
    SUPPRESSED.incrementAndGet();
    return false;
  }

  public static void dispatch(Runnable action) {
    boolean previous = DISPATCH.get();
    DISPATCH.set(true);
    try {
      action.run();
    } finally {
      DISPATCH.set(previous);
    }
  }
}
