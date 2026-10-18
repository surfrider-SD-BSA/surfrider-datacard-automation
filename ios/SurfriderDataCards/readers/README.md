The open handwriting readers the app runs beside its own (OtherReaders.swift).

The models are 2.5 GB and are not in git. Build them before an iOS build:

    python scripts/export-readers.py

Without them the app builds and runs as before, with Apple's reader as the only second opinion.
