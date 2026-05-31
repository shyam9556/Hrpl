import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('src/components/DealerRequests.jsx', 'rb') as f:
    raw = f.read()

# Find all locations of 0xC3 (which starts most problematic sequences)
positions = [i for i, b in enumerate(raw) if b == 0xC3 and i+1 < len(raw) and raw[i+1] in (0x83, 0xA2, 0x82)]

print(f"Found {len(positions)} potentially garbled sequences")

# Show unique sequences (hex only, no problematic print)
unique_seqs = {}
for pos in positions:
    end = pos
    while end < len(raw) and raw[end] > 127:
        end += 1
    non_ascii = raw[pos:end]
    
    # Get ASCII context before the sequence
    ctx_start = max(0, pos-40)
    ctx_bytes = raw[ctx_start:pos]
    ctx_ascii = ''.join(chr(b) if 32 <= b < 128 else '?' for b in ctx_bytes)
    
    if non_ascii not in unique_seqs:
        unique_seqs[non_ascii] = ctx_ascii[-40:]

for seq, ctx in list(unique_seqs.items())[:20]:
    print(f"\nSEQ hex: {seq.hex()}")
    print(f"  length: {len(seq)}")
    print(f"  context: ...{ctx}")
