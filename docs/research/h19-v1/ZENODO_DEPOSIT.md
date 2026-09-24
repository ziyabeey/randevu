# Zenodo deposit guide for H19 v1

This file is a deposit checklist, not a claim that a Zenodo record has already been published.

## Recommended deposit strategy

Use a **manual Zenodo upload** for the H19 v1 research package instead of archiving the entire product repository as the primary object.

Reason: the citable object is the H19 method and evidence package. Product code remains a related source repository.

Zenodo's official workflow supports creating a draft, uploading files, filling metadata, previewing, and publishing. A DOI can be reserved in the draft before publication with **Get a DOI now!**, which allows the DOI to be inserted into the final files before publication.

Official documentation:

- https://help.zenodo.org/docs/deposit/create-new-upload/
- https://help.zenodo.org/docs/deposit/describe-records/reserve-doi/
- https://help.zenodo.org/docs/deposit/describe-records/resource-type/
- https://help.zenodo.org/docs/deposit/describe-records/licenses/

## Suggested basic metadata

**Title**  
H19 v1: A Preregistered Semantic Interaction Method for Prospective Regression-Test Discovery

**Version**  
1.0.0

**Publication date**  
2026-09-24

**Creator**  
Family name: Terzioğlu  
Given names: Yusuf Ziya

Do not invent an ORCID or institutional affiliation. Add them only if the creator supplies/validates them.

**Resource type**  
Choose **Publication** as the main type because the primary contribution is the method note; the CSV, JSON and Python script are supplementary evidence. If the Zenodo UI offers a more precise report/technical-note subtype that accurately describes the record, choose it.

**Publisher**  
Zenodo, unless this exact object was previously published elsewhere.

**Language**  
English

**Keywords**

- H19
- software testing
- regression testing
- interaction testing
- combinatorial testing
- mutation testing
- concurrency testing
- idempotency
- database testing
- PostgreSQL
- preregistration
- test selection

## Suggested abstract

H19 is a domain-adapted method for prospective regression-test discovery in transaction-heavy software. It represents six semantic authority dimensions in a sparse 19-row interaction geometry and evaluates selected interactions with a preregistered three-arm protocol: a minimal semantic variation must first pass the unchanged canonical suite; a single prospective probe is then frozen; the probe must fail on the variation at the preregistered invariant and pass unchanged on clean code. Experimental variations never merge, while successful clean-control probes may be promoted into a single fail-closed regression gate with provenance.

In the Kepenk/Randevu case study, a preregistered four-round blind queue produced four incremental discoveries. An equal-budget benchmark then compared H19 semantic selection with a simple coverage-first selector across four accepted domains. H19 produced 2 HITs in 4 valid selections; coverage-first produced 3 HITs in 3 valid selections, with one additional baseline cell excluded as protocol-invalid. The benchmark does not establish H19 superiority. It supports the narrower conclusion that H19 can repeatedly generate incremental executable regression tests under prospective controls and can coexist with combinatorial coverage methods.

## License

**Author decision required before publication.**

Zenodo requires a license and defaults to **CC BY 4.0** for general records. CC BY 4.0 is a reasonable default for the methods text and evidence tables if the creator wants broad reuse with attribution. Do not publish until the creator explicitly confirms the desired license.

If source software is later deposited as a separate significant object, use an appropriate software license rather than assuming the documentation license applies to code.

## Files to upload

Preferred preservation-friendly set:

1. `METHODS.md`
2. `README.md`
3. `benchmark-v1.csv`
4. `evidence-manifest.json`
5. `h19_geometry.py`
6. `zenodo-metadata-draft.json`

A ZIP archive of the complete directory may be uploaded as an additional convenience file, but keeping the open text/CSV/JSON/Python files individually visible improves inspectability.

## DOI sequence

1. Create **New upload** in Zenodo.
2. Add the package files.
3. Enter the metadata above.
4. In DOI, answer that the upload does not already have a DOI.
5. Click **Get a DOI now!** to reserve one.
6. Insert the reserved DOI into a final human-readable copy if desired.
7. Save draft and preview.
8. Confirm creator identity, license, title, description, related repository, and files.
9. Publish only after final review.

Zenodo registers the DOI when the record is published. Deleting the draft loses the reserved DOI.

## Related source

Repository: https://github.com/ziyabeey/randevu  
Evidence snapshot: https://github.com/ziyabeey/randevu/tree/3e48d2958607ef20660835cdabd884cc7d3738e2  
Benchmark preregistration: https://github.com/ziyabeey/randevu/issues/485  
Blind queue v2: https://github.com/ziyabeey/randevu/issues/454  
Permanent-promotion PR: https://github.com/ziyabeey/randevu/pull/520
