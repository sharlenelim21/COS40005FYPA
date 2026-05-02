import os
import sys

# Add the app directory to Python's module search path
sys.path.append(os.path.join(os.path.dirname(__file__), "app"))

# Import and run uvicorn
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8011,
        workers=1,
        limit_concurrency=100,
        reload=False  # Windows/Python 3.14 can hang with the reloader subprocess
    )
