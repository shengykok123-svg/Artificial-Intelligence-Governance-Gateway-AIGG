"""Training utilities for optional ML modules.

These scripts intentionally sit outside ``app/``: the FastAPI policy plane
only loads saved model artifacts at runtime and never trains a model itself.
"""

