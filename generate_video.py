import torch
from diffusers import I2VGenXLPipeline
from diffusers.utils import export_to_gif, load_image
from os import listdir
from os.path import isfile, join

folder = "E:\story video\story\Fairy Lanterns and the Night of Wishes\images"
onlyfiles = [f for f in listdir(folder) if isfile(join(folder, f))]

pipeline = I2VGenXLPipeline.from_pretrained("ali-vilab/i2vgen-xl", torch_dtype=torch.float16, variant="fp16").to("cuda")
pipeline.enable_model_cpu_offload()

for file in onlyfiles:
    if not file.endswith(".png"):
        continue
    fullPath = folder +"\\" + file
    image = load_image(fullPath).convert("RGB")
    prompt = "An image of curious Lily wandering through the dense forest, a glimmer of light catching her eye."
    negative_prompt = "Distorted, discontinuous, Ugly, blurry, low resolution, motionless, static, disfigured, disconnected limbs, Ugly faces, incomplete arms"
    generator = torch.manual_seed(0)
    frames = pipeline(
        prompt=prompt,
        image=image,
        num_inference_steps=50,
        negative_prompt=negative_prompt,
        guidance_scale=1.0,
        ##generator=generator
    ).frames[0]
    export_to_gif(frames,fullPath.replace(".png", ".gif"))




