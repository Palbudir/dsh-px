package com.palbudir.dshpx.bridge.mixin;

import com.palbudir.dshpx.bridge.VirtualInput;
import net.minecraft.client.MouseHandler;
import net.minecraft.client.input.MouseButtonInfo;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MouseHandler.class)
public abstract class MouseMixin {
  @Inject(method = "onButton", at = @At("HEAD"), cancellable = true)
  private void button(long window, MouseButtonInfo button, int action, CallbackInfo ci) {
    if (!VirtualInput.accepts()) ci.cancel();
  }

  @Inject(method = "onMove", at = @At("HEAD"), cancellable = true)
  private void move(long window, double x, double y, double dx, double dy, CallbackInfo ci) {
    if (!VirtualInput.accepts()) ci.cancel();
  }

  @Inject(method = "onScroll", at = @At("HEAD"), cancellable = true)
  private void scroll(long window, double x, double y, CallbackInfo ci) {
    if (!VirtualInput.accepts()) ci.cancel();
  }

  @Inject(method = "resyncMousePosition", at = @At("HEAD"), cancellable = true)
  private void noPhysicalPosition(CallbackInfo ci) {
    if (VirtualInput.ISOLATED) ci.cancel();
  }
}
