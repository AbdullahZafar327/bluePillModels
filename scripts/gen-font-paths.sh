#!/usr/bin/env bash

# ============================================================
# CONFIG
# ============================================================

# Run from project root.
FONT_BASE="./fonts"

# Font family folder inside FONT_BASE.
FONT_FAMILY="bricolage"

# CDN base.
CDN_BASE="https://cdn.jsdelivr.net/gh/AbdullahZafar327/bluePillModels@main/fonts"

# ============================================================
# PATH
# ============================================================

FAMILY_DIR="${FONT_BASE}/${FONT_FAMILY}"

if [ ! -d "$FAMILY_DIR" ]; then
    echo "✗ Font family folder not found: $FAMILY_DIR"
    exit 1
fi

# ============================================================
# HELPERS
# ============================================================

to_camel() {
    local folder="$1"

    # Remove everything through the first "-"
    #
    # B-bold    → bold
    # B-24-reg  → 24-reg
    # B-24c-reg → 24c-reg
    #
    local variant="${folder#*-}"

    # Convert hyphen-separated parts to camelCase
    #
    # 24-reg  → 24Reg
    # 24c-reg → 24cReg
    #
    variant="$(echo "$variant" | sed -E 's/-([a-zA-Z0-9])/\U\1/g')"

    # JS property cannot start with a number.
    #
    # 24Reg → v24Reg
    #
    if [[ "$variant" =~ ^[0-9] ]]; then
        variant="v${variant}"
    fi

    echo "$variant"
}

# ============================================================
# FIND VARIANT FOLDERS
# ============================================================

FOLDERS=()

while IFS= read -r folder; do
    FOLDERS+=("$(basename "$folder")")
done < <(
    find "$FAMILY_DIR" \
        -maxdepth 1 \
        -mindepth 1 \
        -type d \
        | sort
)

if [ ${#FOLDERS[@]} -eq 0 ]; then
    echo "✗ No variant folders found in $FAMILY_DIR"
    exit 1
fi

# ============================================================
# OUTPUT
# ============================================================

echo ""
echo "export const Fonts = {"
echo "  ${FONT_FAMILY}: {"

for FOLDER in "${FOLDERS[@]}"; do

    KEY="$(to_camel "$FOLDER")"

    CDN_PATH="${CDN_BASE}/${FONT_FAMILY}/${FOLDER}"

    echo "    ${KEY}: {"
    echo "      png:  \"${CDN_PATH}/atlas.png\","
    echo "      json: \"${CDN_PATH}/atlas.json\","
    echo "      ktx2: \"${CDN_PATH}/atlas-datatexture.ktx2\","
    echo "    },"

done

echo "  },"
echo "};"
echo ""