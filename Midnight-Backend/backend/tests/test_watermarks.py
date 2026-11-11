import watermarks as w


def test_known_publishers_use_the_second_image(monkeypatch):
    for u in ("https://www.bbc.co.uk/news/x", "https://www.cbc.ca/news/y", "https://www.cnbc.com/z", "https://abcnews.go.com/a",
              "https://www.nbcnews.com/b", "https://news.sky.com/c"):
        assert w.is_watermarked(u), u
    assert not w.is_watermarked("https://www.npr.org/x") and not w.is_watermarked("https://notbbc.com/x")


def test_env_can_add_remove_and_disable(monkeypatch):
    monkeypatch.setenv("WATERMARK_SITES_ADD", "example.org")
    monkeypatch.setenv("WATERMARK_SITES_REMOVE", "cnn.com")
    assert w.is_watermarked("https://news.example.org/a") and not w.is_watermarked("https://edition.cnn.com/a")
    monkeypatch.setenv("WATERMARK_SECOND_IMAGE", "off")
    assert not w.is_watermarked("https://www.bbc.com/a")


def test_prefer_second_skips_the_same_photo_at_another_size():
    same = lambda a, b: a[0] != b[0]            # distinct when the first letter differs
    assert w.prefer_second(["a1", "a2", "b1"], same) == ["b1", "a1", "a2"]
    assert w.prefer_second(["a1"], same) == ["a1"]
    assert w.prefer_second(["a1", "a2"], same) == ["a1", "a2"]      # no distinct second picture: keep the first
