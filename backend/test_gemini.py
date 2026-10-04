"""Quick Gemini API key test — run with: python test_gemini.py"""
import os, sys
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    sys.exit("ERROR: GEMINI_API_KEY not set in .env")

print(f"Using key: ...{api_key[-6:]}")

from google import genai
from google.genai import types

client = genai.Client(api_key=api_key)

# 1. List available models
print("\n--- Available models (generate_content capable) ---")
try:
    for m in client.models.list():
        if hasattr(m, "supported_actions") and "generateContent" in (m.supported_actions or []):
            print(f"  {m.name}")
        elif "generateContent" in str(getattr(m, "supported_generation_methods", [])):
            print(f"  {m.name}")
except Exception as e:
    print(f"ListModels error: {e}")

# 2. Simple generate test
print("\n--- Generate test ---")
try:
    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents=[types.Content(role="user", parts=[types.Part(text="Say hello in one word.")])],
    )
    print(f"gemini-2.0-flash-lite response: {response.text.strip()}")
except Exception as e:
    print(f"gemini-2.0-flash-lite error: {e}")

# 3. Fallback model test
print("\n--- Fallback model test (gemini-2.0-flash) ---")
try:
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=[types.Content(role="user", parts=[types.Part(text="Say hello in one word.")])],
    )
    print(f"gemini-2.0-flash response: {response.text.strip()}")
except Exception as e:
    print(f"gemini-2.0-flash error: {e}")
