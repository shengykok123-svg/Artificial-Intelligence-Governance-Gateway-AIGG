"""Two-head DeBERTa model used by M9.

One shared encoder predicts a department and whether a sentence is internal
confidential content. Keeping both heads together avoids a fragile cascade in
which a wrong department prediction controls the sensitivity prediction.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import torch
from torch import nn
from transformers import AutoConfig, AutoModel, PreTrainedModel
from transformers.utils import ModelOutput


@dataclass
class M9MultiTaskOutput(ModelOutput):
    loss: Optional[torch.FloatTensor] = None
    department_logits: Optional[torch.FloatTensor] = None
    sensitivity_logits: Optional[torch.FloatTensor] = None


class DebertaM9MultiTaskModel(PreTrainedModel):
    """DeBERTa encoder with independent department and sensitivity heads."""

    config_class = AutoConfig
    base_model_prefix = "encoder"

    def __init__(self, config) -> None:  # type: ignore[no-untyped-def]
        super().__init__(config)
        self.encoder = AutoModel.from_config(config)
        self.dropout = nn.Dropout(getattr(config, "hidden_dropout_prob", 0.1))
        self.department_classifier = nn.Linear(config.hidden_size, len(config.m9_department_labels))
        self.sensitivity_classifier = nn.Linear(config.hidden_size, len(config.m9_sensitivity_labels))
        self.post_init()

    @classmethod
    def from_base_model(
        cls,
        model_name: str,
        department_labels: tuple[str, ...],
        sensitivity_labels: tuple[str, ...],
    ) -> "DebertaM9MultiTaskModel":
        config = AutoConfig.from_pretrained(model_name)
        config.m9_department_labels = list(department_labels)
        config.m9_sensitivity_labels = list(sensitivity_labels)
        model = cls(config)
        model.encoder = AutoModel.from_pretrained(model_name, config=config)
        return model

    def forward(
        self,
        input_ids=None,
        attention_mask=None,
        token_type_ids=None,
        department_labels=None,
        sensitivity_labels=None,
        **kwargs,
    ) -> M9MultiTaskOutput:  # type: ignore[no-untyped-def]
        encoded = self.encoder(
            input_ids=input_ids,
            attention_mask=attention_mask,
            token_type_ids=token_type_ids,
            **kwargs,
            return_dict=True,
        )
        # Trainer/Accelerate may run the encoder under GPU autocast (float16)
        # while newly initialised classification heads remain float32. Cast the
        # pooled representation to the head dtype so both ordinary fp32 and
        # mixed-precision Colab runs are valid.
        pooled = self.dropout(encoded.last_hidden_state[:, 0]).to(self.department_classifier.weight.dtype)
        department_logits = self.department_classifier(pooled)
        sensitivity_logits = self.sensitivity_classifier(pooled)
        loss = None
        if department_labels is not None and sensitivity_labels is not None:
            loss_function = nn.CrossEntropyLoss()
            loss = loss_function(department_logits, department_labels) + loss_function(
                sensitivity_logits, sensitivity_labels
            )
        return M9MultiTaskOutput(
            loss=loss,
            department_logits=department_logits,
            sensitivity_logits=sensitivity_logits,
        )
