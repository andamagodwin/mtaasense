"""Operator commands.

python -m app.cli create-user --email reviewer@example.org --name "Reviewer" --role reviewer
(password is read from MTAA_NEW_USER_PASSWORD or prompted; never passed on the command line)
"""

import argparse
import getpass
import os
import sys

from sqlalchemy import func, select

from app.core.security import hash_password
from app.db.models import User
from app.db.models.enums import UserRole
from app.db.session import session_scope


def create_user(email: str, name: str, role: UserRole, password: str) -> str:
    if len(password) < 12:
        raise SystemExit("Password must be at least 12 characters.")
    with session_scope() as db:
        existing = db.scalar(select(User).where(func.lower(User.email) == email.lower()))
        if existing is not None:
            existing.password_hash = hash_password(password)
            existing.role = role
            existing.display_name = name
            existing.is_active = True
            return "updated"
        db.add(User(email=email, display_name=name, role=role, password_hash=hash_password(password)))
        return "created"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    cu = sub.add_parser("create-user", help="Create or update a reviewer/admin account")
    cu.add_argument("--email", required=True)
    cu.add_argument("--name", required=True)
    cu.add_argument("--role", choices=[r.value for r in UserRole], default=UserRole.reviewer.value)
    args = parser.parse_args(argv)

    if args.command == "create-user":
        password = os.environ.get("MTAA_NEW_USER_PASSWORD") or getpass.getpass("Password: ")
        result = create_user(args.email.strip(), args.name.strip(), UserRole(args.role), password)
        print(f"User {args.email} {result} with role {args.role}.")


if __name__ == "__main__":
    main(sys.argv[1:])
