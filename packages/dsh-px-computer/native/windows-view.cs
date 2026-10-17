using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public sealed class PointerRequest {
    public int pid;
    public long window_id;
    public double x, y;
    public int image_width, image_height;
    public double window_width, window_height;
}

internal static class WindowsView {
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int x, y; }
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect value, int size);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll", SetLastError=true)] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);

    internal static Rect Bounds(IntPtr window) {
        Rect result;
        if (DwmGetWindowAttribute(window, 9, out result, Marshal.SizeOf(typeof(Rect))) != 0)
            throw new InvalidOperationException("Window geometry is unavailable");
        return result;
    }
    internal static object Magnify(string input, string output) {
        if (new FileInfo(input).Length > 16 * 1024 * 1024) throw new ArgumentException("Zoom image too large");
        using (var image = Image.FromFile(input)) {
            if (image.Width <= 0 || image.Height <= 0 || (long)image.Width * image.Height > 16000000)
                throw new ArgumentException("Invalid zoom dimensions");
            double scale = Math.Max(1, Math.Min(4, 1600.0 / Math.Max(image.Width, image.Height)));
            int width = (int)Math.Round(image.Width * scale), height = (int)Math.Round(image.Height * scale);
            using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
                using (var graphics = Graphics.FromImage(bitmap)) {
                    graphics.CompositingMode = CompositingMode.SourceCopy;
                    graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
                    graphics.PixelOffsetMode = PixelOffsetMode.Half;
                    graphics.DrawImage(image, new Rectangle(0, 0, width, height), 0, 0, image.Width, image.Height, GraphicsUnit.Pixel);
                }
                bitmap.Save(output, ImageFormat.Png);
            }
            return new { width = width, height = height, source_width = image.Width, source_height = image.Height };
        }
    }
    internal static object MovePointer(PointerRequest request) {
        if (request == null || request.pid <= 0 || request.window_id <= 0 || request.image_width <= 0 || request.image_height <= 0 ||
            double.IsNaN(request.x) || double.IsNaN(request.y) || double.IsInfinity(request.x) || double.IsInfinity(request.y) ||
            request.x < 0 || request.y < 0 || request.x >= request.image_width || request.y >= request.image_height)
            throw new ArgumentException("Pointer coordinates must lie inside the observed image");
        var window = new IntPtr(request.window_id); uint owner;
        if (GetWindowThreadProcessId(window, out owner) == 0 || owner != request.pid || GetForegroundWindow() != window)
            throw new InvalidOperationException("Exact target must already be foreground");
        foreach (int button in new int[] { 1, 2, 4 })
            if ((GetAsyncKeyState(button) & 0x8000) != 0) throw new InvalidOperationException("A mouse button is held; pointer move refused");
        Rect bounds = Bounds(window);
        if (bounds.right - bounds.left != request.window_width || bounds.bottom - bounds.top != request.window_height)
            throw new InvalidOperationException("Window resized; observe again before moving the pointer");
        // Pinned Cua bitmap_to_screen: DWM frame + one-pixel inset, with its width-based resize ratio.
        double ratio = (request.window_width - 2) / request.image_width;
        var point = new Point { x = bounds.left + 1 + (int)(request.x * ratio), y = bounds.top + 1 + (int)(request.y * ratio) };
        if (GetAncestor(WindowFromPoint(point), 2) != window || GetForegroundWindow() != window)
            throw new InvalidOperationException("The pointer target is covered or no longer belongs to the foreground window");
        if (!SetCursorPos(point.x, point.y)) throw new InvalidOperationException("Pointer movement failed: " + Marshal.GetLastWin32Error());
        Point actual; GetCursorPos(out actual);
        return new { requested_x = point.x, requested_y = point.y, actual_x = actual.x, actual_y = actual.y };
    }
}
