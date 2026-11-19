"""Section 6 — Group Contributions."""

from __future__ import annotations

from docx_engine import Doc


def build_section_6(doc: Doc) -> None:
    doc.h1("6. GROUP CONTRIBUTIONS")

    doc.p(
        "The table below records each member\u2019s assigned responsibilities and specific "
        "contributions. It is written to be filled in by the group: the responsibility areas "
        "are the actual workstreams this project contained, so the mapping can be made "
        "accurately rather than generically.",
        align="justify",
    )

    doc.table(
        ["Group Member", "Assigned Responsibilities", "Specific Contributions"],
        [
            ["[SURNAME, First Name]",
             "Machine learning: dataset preparation and model development",
             "Built the synthetic corpus generator; fitted the Riegel reference curve with Ridge "
             "shrinkage; trained the three quantile regressors; exported the JSON tree ensemble "
             "for browser parity"],
            ["[SURNAME, First Name]",
             "Machine learning: evaluation and validation",
             "Built the per-user chronological walk-forward evaluator; obtained and processed the "
             "GeoLife dataset; ran the external validation and the paired ablation; authored the "
             "held-out retraining study and its 16 tests"],
            ["[SURNAME, First Name]",
             "Backend and inference service",
             "Implemented the FastAPI inference service and its endpoints; built the Laravel "
             "prediction orchestration, authentication, throttling, and persistence layer"],
            ["[SURNAME, First Name]",
             "Front end and interface",
             "Built the Svelte progressive web app; implemented the client-side tree evaluator "
             "and its parity test; wired the externally validated error margin into the "
             "prediction card; built the map route planner"],
            ["[SURNAME, First Name]",
             "Data layer, deployment, and quality",
             "Designed the PostgreSQL schema and migrations; configured CI across all three "
             "layers; deployed the API, ML service, and web app; authored the smoke-test suite"],
            ["[SURNAME, First Name]",
             "Documentation and analysis",
             "Authored the methodology document and this documentation; produced the reporting "
             "JSON artifacts; built the presentation deck and the demonstration checklist"],
        ],
        caption="Group contributions. Replace the bracketed name placeholders with the actual members; the responsibility and contribution columns are already accurate to the work performed.",
        widths=[1.3, 2.2, 2.9],
        align_numeric=False,
        font_size=8.5,
    )

    doc.p(
        "A note on how to complete this table honestly: the contribution descriptors above "
        "correspond to real, separable artifacts in the repository (the generator, the "
        "evaluator, the retraining study, the inference service, the front-end evaluator, the "
        "CI configuration). A member\u2019s row can be verified against commit history, so the "
        "table should be filled to match what each person actually built rather than divided "
        "evenly for appearance. If one member carried several workstreams, name several "
        "workstreams in their row.",
        align="justify",
    )
