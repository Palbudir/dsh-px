package com.palbudir.dshpx.bridge.mixin;

import com.palbudir.dshpx.bridge.BridgeMod;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Minecraft.class)
public abstract class MinecraftMixin {
  @Inject(method = "runTick", at = @At("HEAD"))
  private void frame(boolean tick, CallbackInfo ci) {
    BridgeMod.frame();
  }

  @Inject(method = "runTick", at = @At("TAIL"))
  private void afterFrame(boolean tick, CallbackInfo ci) {
    BridgeMod.afterFrame();
  }

  @Inject(method = "close", at = @At("HEAD"))
  private void close(CallbackInfo ci) {
    BridgeMod.close();
  }
}
