# Dependencies

This directory contains scripts that initialize dependencies on server startup. These scripts are executed when the FastAPI server starts, ensuring that all necessary dependencies are in place before the application begins processing requests.

To add more lifespans, add in main.py for example:

```python
from fastapi import FastAPI
from contextlib import asynccontextmanager

# Composite the lifespans
from dependency_one import lifespan_1
from dependency_two import lifespan_2
from dependency_three import lifespan_3

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Asynchronous context manager for managing the lifespan of the FastAPI application.

    This function initializes and cleans up resources required for the application.
    Specifically, it loads a YOLO model for bounding box detection during the startup
    phase and ensures proper cleanup during the shutdown phase.

    Args:
        app (FastAPI): The FastAPI application instance.

    Yields:
        None: The main application runs during the yield statement.
    """
    async with lifespan_1(app):
        async with lifespan_2(app):
            async with lifespan_3(app):
                yield

# Create the FastAPI app with the composite lifespan
app = FastAPI(lifespan=lifespan)
```
