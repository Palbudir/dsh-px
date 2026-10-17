// Cross-virtual-desktop support for verified classic HWND controls. No arbitrary messages or focus changes.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public sealed class ControlRequest {
    public int pid;
    public long window_id;
    public long child_id;
    public string class_name;
    public string expected_text;
    public string action;
    public string value;
}

internal sealed class NativeControlForegroundChanged : InvalidOperationException {
    public NativeControlForegroundChanged() : base("Application changed foreground during background action; stop and inspect") { }
}

internal static class WindowsControls {
    private delegate bool EnumCallback(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr window, EnumCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder value, int length);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();

    private static string ClassName(IntPtr window) {
        var value = new StringBuilder(256);
        if (GetClassName(window, value, value.Capacity) == 0) throw new InvalidOperationException("Control disappeared");
        return value.ToString();
    }
    private static string Role(string className, long style) {
        bool button = className.Equals("Button", StringComparison.OrdinalIgnoreCase) || className.StartsWith("WindowsForms10.BUTTON.", StringComparison.OrdinalIgnoreCase);
        bool edit = className.Equals("Edit", StringComparison.OrdinalIgnoreCase) || className.StartsWith("WindowsForms10.EDIT.", StringComparison.OrdinalIgnoreCase);
        if (button && (style & 15) != 7) return "Button";
        if (edit && (style & 32) == 0 && (style & 0x800) == 0) return "Edit"; // No password or read-only fields.
        return null;
    }
    private static string Text(IntPtr window) {
        IntPtr length;
        if (SendMessageTimeout(window, 0xE, IntPtr.Zero, IntPtr.Zero, 3, 100, out length) == IntPtr.Zero) return null;
        long size = length.ToInt64();
        if (size < 0 || size > 4096) return null;
        IntPtr buffer = Marshal.AllocHGlobal(((int)size + 1) * 2);
        try {
            IntPtr copied;
            if (SendMessageTimeout(window, 0xD, new IntPtr(size + 1), buffer, 3, 100, out copied) == IntPtr.Zero) return null;
            long count = copied.ToInt64();
            if (count < 0 || count > size) return null;
            return Marshal.PtrToStringUni(buffer, (int)count);
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    private static void Owner(int pid, IntPtr root, IntPtr child) {
        uint rootOwner, childOwner;
        if (pid <= 0 || GetWindowThreadProcessId(root, out rootOwner) == 0 || rootOwner != pid ||
            GetWindowThreadProcessId(child, out childOwner) == 0 || childOwner != pid || GetAncestor(child, 2) != root)
            throw new InvalidOperationException("Control no longer belongs to the observed window");
    }
    public static object Observe(int pid, long windowId) {
        var root = new IntPtr(windowId);
        Owner(pid, root, root);
        var controls = new List<object>(); int visited = 0, characters = 0;
        EnumChildWindows(root, (child, ignored) => {
            if (++visited > 160 || controls.Count >= 80) return false;
            try {
                Owner(pid, root, child);
                if (!IsWindowVisible(child) || !IsWindowEnabled(child)) return true;
                string className = ClassName(child), role = Role(className, GetWindowLongPtr(child, -16).ToInt64());
                if (role == null) return true;
                string text = Text(child);
                if (text == null) return true;
                if (characters + text.Length > 12000) return false;
                characters += text.Length;
                controls.Add(new { child_id = child.ToInt64(), class_name = className, role = role, text = text });
            } catch { }
            return true;
        }, IntPtr.Zero);
        return new { pid = pid, window_id = windowId, controls = controls };
    }
    public static object Act(ControlRequest request) {
        if (request == null || request.value != null && request.value.Length > 4096) throw new ArgumentException("Invalid control request");
        var root = new IntPtr(request.window_id); var child = new IntPtr(request.child_id);
        Owner(request.pid, root, child);
        if (!IsWindowEnabled(child)) throw new InvalidOperationException("Control is disabled");
        string className = ClassName(child), role = Role(className, GetWindowLongPtr(child, -16).ToInt64());
        if (role == null || className != request.class_name || Text(child) != request.expected_text)
            throw new InvalidOperationException("Control changed since observation; observe again before acting");
        var before = GetForegroundWindow(); IntPtr result;
        if (request.action == "click" && role == "Button") {
            if (SendMessageTimeout(child, 0xF5, IntPtr.Zero, IntPtr.Zero, 3, 1000, out result) == IntPtr.Zero)
                throw new InvalidOperationException("Button message timed out; effect unknown, do not replay");
        } else if (request.action == "set_value" && role == "Edit" && request.value != null) {
            IntPtr value = Marshal.StringToHGlobalUni(request.value);
            try {
                if (SendMessageTimeout(child, 0xC, IntPtr.Zero, value, 3, 1000, out result) == IntPtr.Zero || result == IntPtr.Zero)
                    throw new InvalidOperationException("Text message failed; inspect before retrying");
            } finally { Marshal.FreeHGlobal(value); }
        } else throw new InvalidOperationException("This control does not support that background action");
        if (GetForegroundWindow() != before) throw new NativeControlForegroundChanged();
        return new { ok = true, effect = request.action == "set_value" && Text(child) == request.value ? "confirmed" : "unverifiable" };
    }
}
