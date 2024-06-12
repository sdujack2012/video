from compel import Compel, ReturnedEmbeddingsType
from diffusers import  StableDiffusion3Pipeline
import torch
import sys, json

torch.backends.cuda.matmul.allow_tf32 = True

if sys.argv[1] is None:
    sys.exit(0)

with open(sys.argv[1], "r") as file:
    imageInfos = json.load(file)
    model_id = "stabilityai/stable-diffusion-3-medium-diffusers"
    pipeline = StableDiffusion3Pipeline.from_pretrained(model_id, torch_dtype=torch.float16, token="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")
    pipeline = pipeline.to("cuda")

    compel = Compel(tokenizer=[pipeline.tokenizer, pipeline.tokenizer_2] , text_encoder=[pipeline.text_encoder, pipeline.text_encoder_2], returned_embeddings_type=ReturnedEmbeddingsType.PENULTIMATE_HIDDEN_STATES_NON_NORMALIZED, requires_pooled=[False, True])
    
    with torch.inference_mode():
        for imageInfo in imageInfos:
            conditioning, pooled = compel(imageInfo["prompt"])
            image = pipeline(
                prompt_embeds=conditioning, 
                pooled_prompt_embeds=pooled,
                negative_prompt="ugly, tiling, poorly drawn hands, poorly drawn feet, poorly drawn face, out of frame, extra limbs, disfigured, deformed, body out of frame, bad anatomy, watermark, signature, cut off, low contrast, underexposed, overexposed, bad art, beginner, amateur, distorted face",
                num_inference_steps=28, 
                guidance_scale=7.0, 
                height=imageInfo["height"], 
                width=imageInfo["width"]).images[0]
            image.save(imageInfo["outputFile"])





