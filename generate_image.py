from diffusers import StableDiffusionXLPipeline
import torch
import sys, json
torch.backends.cuda.matmul.allow_tf32 = True

if sys.argv[1] is None:
    sys.exit(0)

with open(sys.argv[1], "r") as file:
    imageInfos = json.load(file)
    model_id = "stabilityai/stable-diffusion-xl-base-1.0"
    pipeline = StableDiffusionXLPipeline.from_pretrained(
        model_id, torch_dtype=torch.bfloat16, use_safetensors=True
    ).to("cuda")
    pipeline.enable_model_cpu_offload()
    pipeline.enable_xformers_memory_efficient_attention()
    
    with torch.inference_mode():
        for imageInfo in imageInfos:
            image = pipeline(imageInfo["prompt"], num_inference_steps=20, height=imageInfo["height"], width=imageInfo["width"]).images[0]
            image.save(imageInfo["outputFile"])





