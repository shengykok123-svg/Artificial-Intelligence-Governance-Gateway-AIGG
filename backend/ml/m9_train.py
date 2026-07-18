"""Fine-tune DeBERTa-v3-small for M9 sentence-level department classification."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import torch
from datasets import Dataset
from sklearn.metrics import f1_score, precision_recall_fscore_support
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    DataCollatorWithPadding,
    Trainer,
    TrainingArguments,
    set_seed,
)

from ml.m9_data import DEPARTMENT_LABELS, ID_TO_LABEL, LABEL_TO_ID, read_jsonl

BACKEND_ROOT = Path(__file__).resolve().parents[1]
MODEL_NAME = "microsoft/deberta-v3-small"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=float, default=3)
    parser.add_argument("--train-batch-size", type=int, default=8)
    parser.add_argument("--eval-batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    return parser.parse_args()


def build_dataset(records: list[dict[str, str]], tokenizer: Any) -> Dataset:
    """Turn validated M9 records into a tokenized single-label dataset."""
    rows = [{"text": row["text"], "labels": LABEL_TO_ID[row["label"]]} for row in records]
    dataset = Dataset.from_list(rows)
    return dataset.map(lambda batch: tokenizer(batch["text"], truncation=True, max_length=256), batched=True)


def compute_metrics(prediction: Any) -> dict[str, float]:
    labels = prediction.label_ids
    predicted = np.argmax(prediction.predictions, axis=-1)
    precision, recall, f1, _support = precision_recall_fscore_support(
        labels, predicted, average="macro", zero_division=0
    )
    return {
        "macro_precision": float(precision),
        "macro_recall": float(recall),
        "macro_f1": float(f1),
        "accuracy": float((predicted == labels).mean()),
    }


def main() -> None:
    args = parse_args()
    set_seed(42)
    data_dir = BACKEND_ROOT / "data" / "m9"
    artifact_dir = BACKEND_ROOT / "artifacts" / "deberta-m9-detector"
    train_records = read_jsonl(data_dir / "train.jsonl")
    validation_records = read_jsonl(data_dir / "validation.jsonl")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME,
        num_labels=len(DEPARTMENT_LABELS),
        id2label=ID_TO_LABEL,
        label2id=LABEL_TO_ID,
        problem_type="single_label_classification",
    )
    training_args = TrainingArguments(
        output_dir=str(BACKEND_ROOT / "artifacts" / "m9-checkpoints"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.train_batch_size,
        per_device_eval_batch_size=args.eval_batch_size,
        learning_rate=args.learning_rate,
        weight_decay=args.weight_decay,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="macro_f1",
        greater_is_better=True,
        report_to=[],
        seed=42,
        use_cpu=not torch.cuda.is_available(),
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=build_dataset(train_records, tokenizer),
        eval_dataset=build_dataset(validation_records, tokenizer),
        processing_class=tokenizer,
        data_collator=DataCollatorWithPadding(tokenizer=tokenizer),
        compute_metrics=compute_metrics,
    )
    try:
        trainer.train()
    except torch.cuda.OutOfMemoryError as exc:
        raise RuntimeError("CUDA ran out of memory. Reduce --train-batch-size or use CPU.") from exc
    trainer.save_model(str(artifact_dir))
    tokenizer.save_pretrained(artifact_dir)
    metrics = trainer.evaluate()
    artifact_dir.parent.mkdir(parents=True, exist_ok=True)
    (artifact_dir.parent / "m9_training_metrics.json").write_text(
        json.dumps(metrics, indent=2), encoding="utf-8"
    )
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()

