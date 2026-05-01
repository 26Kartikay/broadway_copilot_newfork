"""
data_manager.py — Centralized storage for multiple pandas DataFrames.
"""

from __future__ import annotations

import pandas as pd
from typing import Dict, Optional, List
from context_builder import DatasetContext, build_context


class DataManager:
    """Manages multiple datasets in memory."""

    def __init__(self):
        self._datasets: Dict[str, pd.DataFrame] = {}
        self._contexts: Dict[str, DatasetContext] = {}

    def add_dataset(self, name: str, df: pd.DataFrame):
        """Add a dataset and build its context."""
        self._datasets[name] = df
        self._contexts[name] = build_context(df)

    def get_dataset(self, name: str) -> Optional[pd.DataFrame]:
        """Retrieve a dataset by name."""
        return self._datasets.get(name)

    def get_context(self, name: str) -> Optional[DatasetContext]:
        """Retrieve the context of a dataset by name."""
        return self._contexts.get(name)

    def list_datasets(self) -> List[str]:
        """List all loaded datasets."""
        return list(self._datasets.keys())

    def remove_dataset(self, name: str):
        """Remove a dataset and its context."""
        if name in self._datasets:
            del self._datasets[name]
        if name in self._contexts:
            del self._contexts[name]

    def clear(self):
        """Remove all datasets."""
        self._datasets.clear()
        self._contexts.clear()

    @property
    def datasets(self) -> Dict[str, pd.DataFrame]:
        """Expose all datasets for the executor."""
        return self._datasets


# Global instance
manager = DataManager()
