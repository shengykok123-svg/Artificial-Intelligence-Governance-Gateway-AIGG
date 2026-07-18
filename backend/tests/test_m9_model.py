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
