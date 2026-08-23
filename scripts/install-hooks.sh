#!/bin/sh
# Wire the committed pre-commit script into .git/hooks (run once per clone).
cp scripts/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
echo "pre-commit hook installed"
