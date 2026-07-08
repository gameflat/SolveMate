import argparse
import json
import pathlib
import shutil
import sys
from datetime import datetime


ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKUP_ROOT = ROOT / "data" / "import-backups"
QUESTION_BANKS = ROOT / "data" / "question-banks.json"


def load_manifest(path):
    manifest_path = path / "manifest.json"
    if not manifest_path.exists():
        return {"id": path.name, "createdAt": "", "fileName": "", "bankName": ""}
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def list_backups():
    if not BACKUP_ROOT.exists():
        return []
    backups = []
    for path in sorted(BACKUP_ROOT.iterdir(), reverse=True):
        if path.is_dir() and (path / "question-banks.json").exists():
            backups.append(load_manifest(path))
    return backups


def restore_backup(backup_id):
    backup_dir = BACKUP_ROOT / backup_id
    backup_file = backup_dir / "question-banks.json"
    if not backup_file.exists():
        raise SystemExit(f"Backup not found: {backup_id}")

    restore_backup_id = f"pre-restore-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    restore_backup_dir = BACKUP_ROOT / restore_backup_id
    restore_backup_dir.mkdir(parents=True, exist_ok=True)
    if QUESTION_BANKS.exists():
        shutil.copy2(QUESTION_BANKS, restore_backup_dir / "question-banks.json")
    (restore_backup_dir / "manifest.json").write_text(
        json.dumps(
            {
                "id": restore_backup_id,
                "createdAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                "type": "pre-restore",
                "restoringBackupId": backup_id,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    shutil.copy2(backup_file, QUESTION_BANKS)
    return restore_backup_id


def main():
    parser = argparse.ArgumentParser(description="List or restore SolveMate question bank import backups.")
    parser.add_argument("--list", action="store_true", help="List available import backups.")
    parser.add_argument("--restore", metavar="BACKUP_ID", help="Restore data/question-banks.json from a backup.")
    args = parser.parse_args()

    if args.list:
        backups = list_backups()
        if not backups:
            print("No import backups found.")
            return
        for item in backups:
            print(
                f"{item.get('id','')} | {item.get('createdAt','')} | "
                f"{item.get('targetMode','')} | {item.get('bankName','')} | {item.get('fileName','')}"
            )
        return

    if args.restore:
        pre_restore_id = restore_backup(args.restore)
        print(f"Restored question banks from {args.restore}.")
        print(f"Current pre-restore backup: {pre_restore_id}.")
        print("Restart SolveMate for the running service to load restored data.")
        return

    parser.print_help(sys.stderr)
    raise SystemExit(2)


if __name__ == "__main__":
    main()
