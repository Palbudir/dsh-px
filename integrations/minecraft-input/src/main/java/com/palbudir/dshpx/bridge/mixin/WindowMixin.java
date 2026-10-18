package com.palbudir.dshpx.bridge.mixin;

import com.mojang.blaze3d.platform.Window;
import com.mojang.blaze3d.platform.cursor.CursorType;
import com.palbudir.dshpx.bridge.VirtualInput;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(Window.class)
public abstract class WindowMixin {
  @Inject(method = "isFocused", at = @At("HEAD"), cancellable = true)
  private void virtualFocus(CallbackInfoReturnable<Boolean> ci) {
    if (VirtualInput.ISOLATED) ci.setReturnValue(true);
  }

  @Inject(method = "selectCursor", at = @At("HEAD"), cancellable = true)
  private void noCursorChange(CursorType type, CallbackInfo ci) {
    if (VirtualInput.ISOLATED) ci.cancel();
  }

  @Inject(method = "setFullscreen", at = @At("HEAD"), cancellable = true)
  private void windowedOnly(boolean value, CallbackInfo ci) {
    if (VirtualInput.ISOLATED) ci.cancel();
  }
}
