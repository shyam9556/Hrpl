import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('src/components/DealerRequests.jsx', 'rb') as f:
    raw = f.read()

# All unique sequences found, mapped to replacements
# These are all triple-encoded or double-encoded UTF-8 mojibake
replacements = [
    # em-dash triple (Ã¢â€™): appears in comments only
    (b'\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\xa2\xe2\x82\xac\xc2\x9d', b' - '),
    # em-dash double
    (b'\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\xa2\xe2\x82\xac\xc2\x9d', b' - '),
    # em-dash simple
    (b'\xc3\xa2\xe2\x82\xac\xc2\x9d', b' - '),
    # right arrow triple (â†')
    (b'\xc3\x83\xc2\xa2\xc3\xa2\xe2\x82\xac\xc2\xa0\xc3\xa2\xe2\x82\xac\xe2\x84\xa2', b' -> '),
    # right arrow double
    (b'\xc3\xa2\xe2\x82\xac\xc2\xa0\xc3\xa2\xe2\x82\xac\xe2\x84\xa2', b' -> '),
    # right arrow simple
    (b'\xc3\xa2\xe2\x82\xac\xe2\x84\xa2', b' -> '),
    # ellipsis triple
    (b'\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\x82\xc2\xa6', b'...'),
    # ellipsis double
    (b'\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\x82\xc2\xa6', b'...'),
    # ellipsis simple
    (b'\xc3\x82\xc2\xa6', b'...'),
]

total = 0
for old, new in replacements:
    count = raw.count(old)
    if count > 0:
        print(f"Replacing {count}x {old.hex()[:12]}... -> '{new.decode()}'")
        raw = raw.replace(old, new)
        total += count

print(f"\nTotal: {total} replacements made")

# Verify no more problematic sequences
remaining = [i for i, b in enumerate(raw) if b == 0xC3 and i+1 < len(raw) and raw[i+1] in (0x83, 0xA2, 0x82)]
print(f"Remaining potentially garbled positions: {len(remaining)}")

with open('src/components/DealerRequests.jsx', 'wb') as f:
    f.write(raw)
print("Saved.")
