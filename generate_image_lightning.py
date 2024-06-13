from compel import Compel, ReturnedEmbeddingsType
from diffusers import StableDiffusionXLPipeline, UNet2DConditionModel, EulerDiscreteScheduler, DPMSolverMultistepScheduler
from safetensors.torch import load_file
from huggingface_hub import hf_hub_download

import torch
import sys, json

torch.backends.cuda.matmul.allow_tf32 = True

if sys.argv[1] is None:
    sys.exit(0)

with open(sys.argv[1], "r", encoding="utf8") as file:
    imageInfos = json.load(file)
    model_id = "stabilityai/stable-diffusion-xl-base-1.0"
    base = "stabilityai/stable-diffusion-xl-base-1.0"
    repo = "ByteDance/SDXL-Lightning"
    ckpt = "sdxl_lightning_4step_unet.safetensors" # Use the correct ckpt for your step setting!

    # Load model.
    unet = UNet2DConditionModel.from_config(base, subfolder="unet").to("cuda", torch.float16)
    unet.load_state_dict(load_file(hf_hub_download(repo, ckpt), device="cuda"))
    pipeline = StableDiffusionXLPipeline.from_pretrained(base, unet=unet, torch_dtype=torch.float16, variant="fp16").to("cuda")
    pipeline.enable_xformers_memory_efficient_attention()
    pipeline.enable_model_cpu_offload()
    pipeline.enable_vae_tiling()
    # Ensure sampler uses "trailing" timesteps.
    pipeline.scheduler = EulerDiscreteScheduler.from_config(pipeline.scheduler.config, timestep_spacing="trailing")
    ##pipeline.scheduler = DPMSolverMultistepScheduler.from_config(pipeline.scheduler.config, algorithm_type="sde-dpmsolver++")
    compel = Compel(tokenizer=[pipeline.tokenizer, pipeline.tokenizer_2] , text_encoder=[pipeline.text_encoder, pipeline.text_encoder_2], returned_embeddings_type=ReturnedEmbeddingsType.PENULTIMATE_HIDDEN_STATES_NON_NORMALIZED, requires_pooled=[False, True])
    
    with torch.inference_mode():
        for imageInfo in imageInfos:
            conditioning, pooled = compel(imageInfo["prompt"])
            image = pipeline(
                prompt_embeds=conditioning, 
                pooled_prompt_embeds=pooled, 
                negative_prompt="ugly, tiling, poorly drawn hands, poorly drawn feet, poorly drawn face, out of frame, extra limbs, disfigured, deformed, body out of frame, bad anatomy, watermark, signature, cut off, low contrast, underexposed, overexposed, bad art, beginner, amateur, distorted face",
                num_inference_steps=4,
                guidance_scale=0,
                num_images_per_prompt=1,
                height=imageInfo["height"], 
                width=imageInfo["width"]).images[0]
            image.save(imageInfo["outputFile"])





