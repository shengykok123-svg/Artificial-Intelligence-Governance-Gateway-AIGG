import pytest


def test_m9_model_casts_encoder_output_to_classification_head_dtype() -> None:
    torch = pytest.importorskip("torch")
    transformers = pytest.importorskip("transformers")

    class FakeEncoder(torch.nn.Module):
        def forward(self, **_kwargs):
            return type("Output", (), {"last_hidden_state": torch.ones((1, 3, 4), dtype=torch.float16)})()

    config = transformers.AutoConfig.for_model("deberta-v2", hidden_size=4, num_hidden_layers=1, num_attention_heads=1)
    config.m9_department_labels = ["finance", "hr", "legal", "engineering", "other"]
    config.m9_sensitivity_labels = ["non_confidential", "confidential"]
    from ml.m9_model import DebertaM9MultiTaskModel

    model = DebertaM9MultiTaskModel(config)
    model.encoder = FakeEncoder()
    output = model(input_ids=torch.ones((1, 3), dtype=torch.long))
    assert output.department_logits.dtype == torch.float32
    assert output.sensitivity_logits.dtype == torch.float32


def test_detector_uses_float32_probabilities_for_half_precision_logits() -> None:
    torch = pytest.importorskip("torch")
    from app.detect.deberta import DebertaDetector

    class Tokenizer:
        def __call__(self, *_args, **_kwargs):
            return {"input_ids": torch.ones((1, 2), dtype=torch.long)}

    class Model:
        class Config:
            m9_department_labels = ["finance", "hr", "legal", "engineering", "other"]
            m9_sensitivity_labels = ["non_confidential", "confidential"]

        config = Config()

        def to(self, _device):
            return self

        def eval(self):
            return self

        def __call__(self, **_kwargs):
            return type("Output", (), {
                "department_logits": torch.tensor([[20.0, 0.0, 0.0, 0.0, 0.0]], dtype=torch.float16),
                "sensitivity_logits": torch.tensor([[0.0, 20.0]], dtype=torch.float16),
            })()

    detector = DebertaDetector(
        model_path=__import__("pathlib").Path("."),
        tokenizer=Tokenizer(),
        model=Model(),
        torch_module=torch,
        device=torch.device("cpu"),
    )
    # Avoid loading a real artifact and supply mappings normally read from config.
    detector._department_labels = tuple(Model.Config.m9_department_labels)
    detector._sensitivity_labels = tuple(Model.Config.m9_sensitivity_labels)
    prediction = detector._predict("test")
    assert prediction.department == "finance"
    assert 0.0 <= prediction.department_confidence <= 1.0
