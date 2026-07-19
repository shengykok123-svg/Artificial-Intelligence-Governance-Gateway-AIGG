"""Fine-tune DeBERTa-v3-small with department and sensitivity output heads."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import torch
from datasets import Dataset
from transformers import AutoTokenizer, DataCollatorWithPadding, Trainer, TrainingArguments, set_seed

from ml.m9_data import DEPARTMENT_TO_ID, SENSITIVITY_TO_ID, read_jsonl
from ml.m9_model import DebertaM9MultiTaskModel

BACKEND_ROOT = Path(__file__).resolve().parents[1]
MODEL_NAME = "microsoft/deberta-v3-small"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=float, default=3)
    parser.add_argument("--train-batch-size", type=int, default=8)
    parser.add_argument("--eval-batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=BACKEND_ROOT / "data" / "m9",
        help="Directory containing train.jsonl and validation.jsonl (default: data/m9).",
    )
    return parser.parse_args()


def build_dataset(records: list[dict[str, Any]], tokenizer: Any) -> Dataset:
    rows = [
        {
            "text": row["text"],
            "department_labels": DEPARTMENT_TO_ID[row["department"]],
            "sensitivity_labels": SENSITIVITY_TO_ID["confidential" if row["is_confidential"] else "non_confidential"],
        }
        for row in records
    ]
    dataset = Dataset.from_list(rows)
    return dataset.map(lambda batch: tokenizer(batch["text"], truncation=True, max_length=256), batched=True)


def compute_metrics(prediction: Any) -> dict[str, float]:
    department_logits, sensitivity_logits = prediction.predictions
    department_labels, sensitivity_labels = prediction.label_ids
    department_predicted = np.argmax(department_logits, axis=-1)
    sensitivity_predicted = np.argmax(sensitivity_logits, axis=-1)
    joint_correct = (department_predicted == department_labels) & (sensitivity_predicted == sensitivity_labels)
    return {
        "department_macro_f1": _macro_f1(department_labels, department_predicted),
        "sensitivity_macro_f1": _macro_f1(sensitivity_labels, sensitivity_predicted),
        "joint_accuracy": float(joint_correct.mean()),
    }


def _macro_f1(labels: np.ndarray, predicted: np.ndarray) -> float:
    """Compute macro F1 without an additional runtime dependency."""
    scores: list[float] = []
    for label in np.unique(np.concatenate((labels, predicted))):
        true_positive = np.sum((labels == label) & (predicted == label))
        false_positive = np.sum((labels != label) & (predicted == label))
        false_negative = np.sum((labels == label) & (predicted != label))
        denominator = (2 * true_positive) + false_positive + false_negative
        scores.append(float((2 * true_positive) / denominator) if denominator else 0.0)
    return float(np.mean(scores)) if scores else 0.0


def main() -> None:
    args = parse_args()
    set_seed(42)
    data_dir = args.data_dir if args.data_dir.is_absolute() else BACKEND_ROOT / args.data_dir
    artifact_dir = BACKEND_ROOT / "artifacts" / "deberta-m9-detector"
    train_records = read_jsonl(data_dir / "train.jsonl")
    validation_records = read_jsonl(data_dir / "validation.jsonl")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = DebertaM9MultiTaskModel.from_base_model(
        MODEL_NAME,
        tuple(DEPARTMENT_TO_ID),
        tuple(SENSITIVITY_TO_ID),
    )
    # Explicitly keep the custom two-head model in fp32. Some hosted GPU
    # environments otherwise select mixed precision automatically; with this
    # small synthetic baseline that can save NaN head weights to the artifact.
    model.float()
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
        metric_for_best_model="joint_accuracy",
        greater_is_better=True,
        report_to=[],
        seed=42,
        use_cpu=not torch.cuda.is_available(),
        fp16=False,
        bf16=False,
        label_names=["department_labels", "sensitivity_labels"],
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
    (artifact_dir.parent / "m9_training_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
