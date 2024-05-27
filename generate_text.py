import transformers
import torch
import functools
import sys, json
import functools
from socketengine import host
import time
@functools.cache
def load_llama_model():
    model_id ="meta-llama/Meta-Llama-3-8B-Instruct"
    pipeline = transformers.pipeline(
        "text-generation",
        model=model_id,
        model_kwargs={
            "torch_dtype": torch.float16,
            "quantization_config": {"load_in_4bit": True},
            "low_cpu_mem_usage": True,
        },
    )
    return pipeline

h = host()
h.start()

print("ready")

while True:  
    time.sleep(0.1)  
    try:        
        inputs = h.get_ALL("inputs")
        if inputs is not None and len(inputs) != 0:
            for input in inputs:
                object = input
                match object["action"]:
                    case "generate_text":
                        pipeline = load_llama_model()
                        prompt = pipeline.tokenizer.apply_chat_template(
                                object["data"], 
                                tokenize=False, 
                                add_generation_prompt=True
                        )

                        terminators = [
                            pipeline.tokenizer.eos_token_id,
                            pipeline.tokenizer.convert_tokens_to_ids("<|eot_id|>")
                        ]

                        outputs = pipeline(
                            prompt,
                            max_new_tokens=1024,
                            eos_token_id=terminators,
                            do_sample=True,
                            temperature=0.6,
                            top_p=0.9,
                        )
                        print(outputs[0]["generated_text"])
                        h.write_ALL(input["clientChannel"], {
                            "role": "assistant",
                            "content": outputs[0]["generated_text"][len(prompt):]           
                        })
                        continue
                    case _:
                        continue
                
    finally:
        h.close()
        
		
