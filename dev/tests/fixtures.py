"""Small test files made on the fly (no binaries in the repo)."""
import os, struct

def cube_stl(path, size=10.0):
    s = size
    v = [(0, 0, 0), (s, 0, 0), (s, s, 0), (0, s, 0), (0, 0, s), (s, 0, s), (s, s, s), (0, s, s)]
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    with open(path, "wb") as f:
        f.write(b"D8 test cube".ljust(80, b" "))
        f.write(struct.pack("<I", len(faces)))
        for a, b, c in faces:
            f.write(struct.pack("<3f", 0, 0, 0))
            for i in (a, b, c): f.write(struct.pack("<3f", *v[i]))
            f.write(b"\0\0")
    return path

def broken_stl(path):
    with open(path, "wb") as f:
        f.write(b"broken".ljust(80, b" ")); f.write(struct.pack("<I", 1000)); f.write(b"\0" * 100)
    return path

def bite_ply(path):
    open(path, "w").write("ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n10 0 0\n0 10 0\n3 0 1 2\n")
    return path

def exocad_html(path):
    open(path, "w").write("<!doctype html><html><head><title>exocad scene</title></head><body><canvas></canvas><p>exocad scene</p></body></html>")
    return path

def make_all(folder):
    os.makedirs(folder, exist_ok=True)
    return {
        "stl": cube_stl(os.path.join(folder, "sample-upper.stl")),
        "broken": broken_stl(os.path.join(folder, "broken.stl")),
        "ply": bite_ply(os.path.join(folder, "bite.ply")),
        "html": exocad_html(os.path.join(folder, "upper-design.html")),
    }
