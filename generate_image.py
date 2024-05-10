from diffusers import AutoPipelineForText2Image
import torch
import sys, json


if sys.argv[1] is None:
    sys.exit(0)

with open(sys.argv[1], "r") as file:
    imageInfos = json.load(file)
    model_id = "stabilityai/stable-diffusion-xl-base-1.0"
    pipeline = AutoPipelineForText2Image.from_pretrained(
        model_id, torch_dtype=torch.float16, use_safetensors=True, cache_dir="./models"
    ).to("cuda")
    pipeline.enable_xformers_memory_efficient_attention()

    with torch.inference_mode():
        for prompt,outputFile  in zip(imageInfos["prompts"],imageInfos["outputFiles"]) :
            print(outputFile, prompt)
            image = pipeline(prompt, num_inference_steps=50, height=imageInfos["height"], width=imageInfos["width"]).images[0]
            image.save(outputFile)





