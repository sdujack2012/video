import torch
import sys, json

from diffusers import AnimateDiffPipeline, LCMScheduler, MotionAdapter
from diffusers.utils import export_to_gif

if sys.argv[1] is None:
    sys.exit(0)

adapter = MotionAdapter.from_pretrained("wangfuyun/AnimateLCM", torch_dtype=torch.float16).to("cuda:1")
pipe = AnimateDiffPipeline.from_pretrained("emilianJR/epiCRealism", motion_adapter=adapter, torch_dtype=torch.float16).to("cuda:1")
pipe.scheduler = LCMScheduler.from_config(pipe.scheduler.config, beta_schedule="linear")

pipe.load_lora_weights("wangfuyun/AnimateLCM", weight_name="AnimateLCM_sd15_t2v_lora.safetensors", adapter_name="lcm-lora")
pipe.set_adapters(["lcm-lora"], [0.8])

pipe.enable_vae_slicing()
pipe.enable_model_cpu_offload()
with open(sys.argv[1], "r", encoding="utf-8") as file:
    videoInfos = json.load(file)

    for videoInfo in videoInfos:
        output = pipe(
            prompt=videoInfo["prompt"],
            negative_prompt="bad quality, worse quality, low resolution",
            num_frames=16,
            guidance_scale=2.0,
            num_inference_steps=6,
            height=videoInfo["height"], 
            width=videoInfo["width"],
            generator=torch.Generator("cpu").manual_seed(0),
        )
        frames = output.frames[0]
        export_to_gif(frames, videoInfos["outputFile"])








