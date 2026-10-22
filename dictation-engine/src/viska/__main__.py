"""`python -m viska`: the dictation engine over stdin and stdout. The
standalone app's --engine flag is still accepted, and ignored."""

from viska.stdio import main

if __name__ == "__main__":
    main()
