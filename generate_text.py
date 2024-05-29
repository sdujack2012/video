import transformers
import torch
import functools

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


def generate_text(messages):
    pipeline = load_llama_model()
    prompt = pipeline.tokenizer.apply_chat_template(
            messages, 
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
    return outputs[0]["generated_text"][len(prompt):] 

        
		
