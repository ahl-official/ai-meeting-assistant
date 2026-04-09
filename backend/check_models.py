import os
import time
from google import genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("ERROR: GEMINI_API_KEY not found in environment.")
else:
    client = genai.Client(api_key=api_key)
    print("\n--- GEMINI MODEL VERIFICATION ---\n")
    print(f"{'Model Name':<30} | {'Status':<15} | {'Verification Test'}")
    print("-" * 75)

    try:
        # Fetch models
        models = client.models.list()
        for m in models:
            # We focus on generation models
            model_id = m.name
            
            # Show progress
            print(f"{model_id:<30} | ", end="", flush=True)
            
            try:
                # Attempt a very small generation task
                response = client.models.generate_content(
                    model=model_id,
                    contents="Say 'System Online'."
                )
                if response.text:
                    print(f"{'ONLINE':<15} | Success: '{response.text.strip()}'")
                else:
                    print(f"{'EMPTY':<15} | Model returned no text.")
            except Exception as model_err:
                error_msg = str(model_err)
                if "429" in error_msg:
                    print(f"{'RATE_LIMIT':<15} | Error: Quota Exceeded (429)")
                elif "404" in error_msg or "not found" in error_msg.lower():
                    print(f"{'NOT_FOUND':<15} | Error: Model unavailable (404)")
                elif "location" in error_msg.lower():
                    print(f"{'LOC_RESTRICT':<15} | Error: Regional restriction")
                else:
                    print(f"{'FAILED':<15} | Error: {error_msg[:40]}...")
            
            # Small delay to avoid hitting rate limits during the test
            time.sleep(1)
            
    except Exception as e:
        print(f"\nCRITICAL ERROR: Could not list models: {e}")

print("\n--- VERIFICATION COMPLETE ---")
