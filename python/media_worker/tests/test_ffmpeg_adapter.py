from __future__ import annotations

import hashlib
import os
import shutil
import wave
from pathlib import Path

import pytest

from media_worker.errors import MediaAdapterError
from media_worker.ffmpeg_adapter import FfmpegAdapter
from media_worker.ffprobe_adapter import FfprobeAdapter


class StubInputProbeAdapter:
    def __init__(self, *, has_audio: bool) -> None:
        self.has_audio = has_audio

    def probe_media(self, input_path: Path, source_kind: str | None = None):
        return type(
            "ProbeResult",
            (),
            {
                "has_audio": self.has_audio,
                "has_video": False,
                "primary_audio_stream_index": 0 if self.has_audio else None,
                "streams": [],
            },
        )()


class StubOutputProbeAdapter:
    def __init__(
        self,
        *,
        codec_name: str = "pcm_s16le",
        sample_rate: int = 16000,
        channels: int = 1,
        has_video: bool = False,
        audio_stream_count: int = 1,
    ) -> None:
        self.codec_name = codec_name
        self.sample_rate = sample_rate
        self.channels = channels
        self.has_video = has_video
        self.audio_stream_count = audio_stream_count
        self.calls: list[tuple[Path, str | None]] = []

    def probe_media(self, input_path: Path, source_kind: str | None = None):
        self.calls.append((input_path, source_kind))
        audio_streams = [
            {
                "index": index,
                "codecType": "audio",
                "codecName": self.codec_name,
                "audio": {
                    "sampleRate": self.sample_rate,
                    "channels": self.channels,
                },
                "disposition": {"attachedPic": False},
            }
            for index in range(self.audio_stream_count)
        ]
        if self.has_video:
            audio_streams.append(
                {
                    "index": 99,
                    "codecType": "video",
                    "codecName": "h264",
                    "video": {"width": 640, "height": 360, "avgFrameRate": 25.0},
                    "disposition": {"attachedPic": False},
                }
            )
        return type(
            "ProbeResult",
            (),
            {
                "has_audio": True,
                "has_video": self.has_video,
                "primary_audio_stream_index": 0,
                "streams": audio_streams,
            },
        )()


def _write_wav_file(path: Path, *, channels: int, sample_rate: int, frames: bytes) -> None:
    with wave.open(str(path), "wb") as output_file:
        output_file.setnchannels(channels)
        output_file.setsampwidth(2)
        output_file.setframerate(sample_rate)
        output_file.writeframes(frames)


def test_normalize_audio_uses_fixed_parameters_streaming_hash_and_output_probe(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    input_path = tmp_path / "lesson.wav"
    input_path.write_bytes(b"input")
    calls: list[list[str]] = []
    output_probe = StubOutputProbeAdapter()

    def runner(args: list[str], **_: object):
        calls.append(args)
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        output_partial = Path(args[-1])
        _write_wav_file(
            output_partial,
            channels=1,
            sample_rate=16000,
            frames=b"\x01\x02" * 800,
        )
        return {"stdout": b"", "stderr": b"", "returncode": 0}

    monkeypatch.setattr(
        Path,
        "read_bytes",
        lambda self: (_ for _ in ()).throw(AssertionError("read_bytes must not be used")),
    )

    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=True),
        ffprobe_adapter=output_probe,
        command_runner=runner,
        create_output_token=lambda: "11111111-1111-4111-8111-111111111111",
        max_output_bytes=4096,
    )

    result = adapter.normalize_audio(input_path)

    assert result.sample_rate == 16000
    assert result.channels == 1
    assert result.codec == "pcm_s16le"
    assert result.size_bytes == result.local_path.stat().st_size
    with result.local_path.open("rb") as stream:
        expected_sha256 = hashlib.sha256(stream.read()).hexdigest()
    assert result.sha256 == expected_sha256
    assert calls[1] == [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-n",
        "-i",
        str(input_path),
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
        "-fs",
        "4096",
        str(result.local_path.with_suffix(".wav.partial")),
    ]
    assert "-y" not in calls[1]
    assert output_probe.calls == [(result.local_path, "audio")]
    manifest = result.to_manifest()
    assert manifest["ffmpegVersion"] == "8.1.1"
    assert "localPath" not in str(manifest)


def test_normalize_audio_rejects_missing_audio_and_existing_target(tmp_path: Path) -> None:
    input_path = tmp_path / "lesson.wav"
    input_path.write_bytes(b"input")
    output_dir = tmp_path / "normalized-audio"
    output_dir.mkdir()
    existing_target = output_dir / "11111111-1111-4111-8111-111111111111.wav"
    existing_target.write_bytes(b"taken")

    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=False),
        command_runner=lambda *_args, **_kwargs: None,
        create_output_token=lambda: "11111111-1111-4111-8111-111111111111",
    )

    with pytest.raises(MediaAdapterError, match="MEDIA_AUDIO_TRACK_MISSING"):
        adapter.normalize_audio(input_path)

    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=True),
        command_runner=lambda *_args, **_kwargs: None,
        create_output_token=lambda: "11111111-1111-4111-8111-111111111111",
    )

    with pytest.raises(MediaAdapterError, match="MEDIA_TRANSCODE_FAILED"):
        adapter.normalize_audio(input_path)

    assert existing_target.read_bytes() == b"taken"


@pytest.mark.parametrize(
    "token",
    [
        "../../escape",
        "11111111-1111-1111-1111-111111111111",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".upper(),
    ],
)
def test_normalize_audio_rejects_invalid_output_tokens_before_command(
    tmp_path: Path,
    token: str,
) -> None:
    input_path = tmp_path / "lesson.wav"
    input_path.write_bytes(b"input")
    calls: list[list[str]] = []

    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=True),
        ffprobe_adapter=StubOutputProbeAdapter(),
        command_runner=lambda args, **_kwargs: calls.append(args),
        create_output_token=lambda: token,
    )

    with pytest.raises(MediaAdapterError, match="MEDIA_TRANSCODE_FAILED"):
        adapter.normalize_audio(input_path)

    assert calls == []


def test_normalize_audio_maps_timeout_to_stable_code_and_cleans_partial(
    tmp_path: Path,
) -> None:
    input_path = tmp_path / "lesson.wav"
    input_path.write_bytes(b"input")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        Path(args[-1]).write_bytes(b"partial")
        raise MediaAdapterError("MEDIA_SUBPROCESS_TIMEOUT", "secret-timeout")

    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=True),
        ffprobe_adapter=StubOutputProbeAdapter(),
        command_runner=runner,
        create_output_token=lambda: "11111111-1111-4111-8111-111111111111",
    )

    with pytest.raises(MediaAdapterError) as error_info:
        adapter.normalize_audio(input_path)

    error = error_info.value
    assert error.code == "MEDIA_TRANSCODE_TIMEOUT"
    assert "secret-timeout" not in str(error)
    assert "secret-timeout" not in repr(error)
    assert "secret-timeout" not in repr(error.__cause__)
    assert "secret-timeout" not in repr(error.__context__)
    assert input_path.exists()
    assert not (tmp_path / "normalized-audio" / "11111111-1111-4111-8111-111111111111.wav.partial").exists()


def test_normalize_audio_maps_probe_runtime_error_to_stable_error(tmp_path: Path) -> None:
    input_path = tmp_path / "lesson.wav"
    input_path.write_bytes(b"input")

    class ExplodingProbeAdapter:
        def probe_media(self, input_path: Path, source_kind: str | None = None):
            raise RuntimeError("secret-probe-path")

    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=ExplodingProbeAdapter(),
        ffprobe_adapter=StubOutputProbeAdapter(),
        command_runner=lambda *_args, **_kwargs: None,
        create_output_token=lambda: "11111111-1111-4111-8111-111111111111",
    )

    with pytest.raises(MediaAdapterError) as error_info:
        adapter.normalize_audio(input_path)

    error = error_info.value
    assert error.code == "MEDIA_TRANSCODE_FAILED"
    assert "secret-probe-path" not in str(error)
    assert "secret-probe-path" not in repr(error)
    assert "secret-probe-path" not in repr(error.__cause__)
    assert "secret-probe-path" not in repr(error.__context__)


def test_normalize_audio_maps_token_factory_runtime_error_to_stable_error(tmp_path: Path) -> None:
    input_path = tmp_path / "lesson.wav"
    input_path.write_bytes(b"input")
    calls: list[list[str]] = []

    def exploding_token_factory() -> str:
        raise RuntimeError("secret-token")

    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=True),
        ffprobe_adapter=StubOutputProbeAdapter(),
        command_runner=lambda args, **_kwargs: calls.append(args),
        create_output_token=exploding_token_factory,
    )

    with pytest.raises(MediaAdapterError) as error_info:
        adapter.normalize_audio(input_path)

    error = error_info.value
    assert error.code == "MEDIA_TRANSCODE_FAILED"
    assert "secret-token" not in str(error)
    assert "secret-token" not in repr(error)
    assert "secret-token" not in repr(error.__cause__)
    assert "secret-token" not in repr(error.__context__)
    assert calls == []


def test_normalize_audio_hides_runner_exception_chain_and_keeps_input(tmp_path: Path) -> None:
    input_path = tmp_path / "lesson.wav"
    input_path.write_bytes(b"input")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        raise RuntimeError("secret-local-path-token")

    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=True),
        ffprobe_adapter=StubOutputProbeAdapter(),
        command_runner=runner,
        create_output_token=lambda: "11111111-1111-4111-8111-111111111111",
    )

    with pytest.raises(MediaAdapterError) as error_info:
        adapter.normalize_audio(input_path)

    error = error_info.value
    assert error.code == "MEDIA_TRANSCODE_FAILED"
    assert "secret-local-path-token" not in str(error)
    assert "secret-local-path-token" not in repr(error)
    assert "secret-local-path-token" not in repr(error.__cause__)
    assert "secret-local-path-token" not in repr(error.__context__)
    assert input_path.exists()


def test_normalize_audio_cleans_final_on_hash_failure_and_hides_secret(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    input_path = tmp_path / "lesson.wav"
    input_path.write_bytes(b"input")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        _write_wav_file(Path(args[-1]), channels=1, sample_rate=16000, frames=b"\x00\x01" * 300)
        return {"stdout": b"", "stderr": b"", "returncode": 0}

    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=True),
        ffprobe_adapter=StubOutputProbeAdapter(),
        command_runner=runner,
        create_output_token=lambda: "11111111-1111-4111-8111-111111111111",
    )
    monkeypatch.setattr(
        adapter,
        "_sha256_file",
        lambda _path: (_ for _ in ()).throw(RuntimeError("secret-hash")),
    )

    with pytest.raises(MediaAdapterError) as error_info:
        adapter.normalize_audio(input_path)

    error = error_info.value
    assert error.code == "MEDIA_TRANSCODE_FAILED"
    assert "secret-hash" not in str(error)
    assert "secret-hash" not in repr(error)
    assert "secret-hash" not in repr(error.__cause__)
    assert "secret-hash" not in repr(error.__context__)
    assert not (tmp_path / "normalized-audio" / "11111111-1111-4111-8111-111111111111.wav").exists()
    assert not (tmp_path / "normalized-audio" / "11111111-1111-4111-8111-111111111111.wav.partial").exists()
    assert input_path.exists()


def test_normalize_audio_cleans_partial_on_output_probe_failure(tmp_path: Path) -> None:
    input_path = tmp_path / "lesson.wav"
    input_path.write_bytes(b"input")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        _write_wav_file(Path(args[-1]), channels=1, sample_rate=16000, frames=b"\x00\x01" * 300)
        return {"stdout": b"", "stderr": b"", "returncode": 0}

    output_probe = StubOutputProbeAdapter(codec_name="aac")
    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=True),
        ffprobe_adapter=output_probe,
        command_runner=runner,
        create_output_token=lambda: "11111111-1111-4111-8111-111111111111",
    )

    with pytest.raises(MediaAdapterError, match="MEDIA_TRANSCODE_FAILED"):
        adapter.normalize_audio(input_path)

    assert not (tmp_path / "normalized-audio" / "11111111-1111-4111-8111-111111111111.wav").exists()
    assert not (tmp_path / "normalized-audio" / "11111111-1111-4111-8111-111111111111.wav.partial").exists()
    assert input_path.exists()


def test_normalize_audio_preserves_concurrent_final_and_cleans_partial(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    input_path = tmp_path / "lesson.wav"
    input_path.write_bytes(b"input")
    output_dir = tmp_path / "normalized-audio"
    output_dir.mkdir()
    final_path = output_dir / "11111111-1111-4111-8111-111111111111.wav"

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        _write_wav_file(Path(args[-1]), channels=1, sample_rate=16000, frames=b"\x00\x01" * 300)
        return {"stdout": b"", "stderr": b"", "returncode": 0}

    real_link = os.link

    def racing_link(src: str | bytes, dst: str | bytes, *args: object, **kwargs: object) -> None:
        final_path.write_bytes(b"winner")
        raise FileExistsError("raced")

    monkeypatch.setattr("media_worker.ffmpeg_adapter.os.link", racing_link)

    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=True),
        ffprobe_adapter=StubOutputProbeAdapter(),
        command_runner=runner,
        create_output_token=lambda: "11111111-1111-4111-8111-111111111111",
    )

    with pytest.raises(MediaAdapterError, match="MEDIA_TRANSCODE_FAILED"):
        adapter.normalize_audio(input_path)

    assert final_path.read_bytes() == b"winner"
    assert not final_path.with_suffix(".wav.partial").exists()
    monkeypatch.setattr("media_worker.ffmpeg_adapter.os.link", real_link)


def test_normalize_audio_enforces_output_size_limit_and_cleans_partial(tmp_path: Path) -> None:
    input_path = tmp_path / "lesson.wav"
    input_path.write_bytes(b"input")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        Path(args[-1]).write_bytes(b"x" * 80)
        return {"stdout": b"", "stderr": b"", "returncode": 0}

    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=True),
        ffprobe_adapter=StubOutputProbeAdapter(),
        command_runner=runner,
        create_output_token=lambda: "11111111-1111-4111-8111-111111111111",
        max_output_bytes=64,
    )

    with pytest.raises(MediaAdapterError, match="MEDIA_TRANSCODE_FAILED"):
        adapter.normalize_audio(input_path)

    assert not (tmp_path / "normalized-audio" / "11111111-1111-4111-8111-111111111111.wav.partial").exists()


@pytest.mark.parametrize(
    ("field_name", "field_value"),
    [
        ("timeout_seconds", True),
        ("timeout_seconds", 0),
        ("max_stdout_bytes", False),
        ("max_stdout_bytes", -1),
        ("max_stderr_bytes", 0),
        ("max_output_bytes", 0),
        ("create_output_token", "not-callable"),
        ("probe_adapter", object()),
        ("ffprobe_adapter", object()),
    ],
)
def test_ffmpeg_adapter_rejects_invalid_configuration(
    tmp_path: Path,
    field_name: str,
    field_value: object,
) -> None:
    kwargs = {
        "workspace_root": tmp_path,
        "probe_adapter": StubInputProbeAdapter(has_audio=True),
        "ffprobe_adapter": StubOutputProbeAdapter(),
    }
    kwargs[field_name] = field_value

    with pytest.raises(MediaAdapterError, match="MEDIA_TRANSCODE_FAILED"):
        FfmpegAdapter(**kwargs)


def test_normalize_audio_rejects_workspace_escape(tmp_path: Path) -> None:
    outside = tmp_path.parent / "outside.wav"
    outside.write_bytes(b"outside")

    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=True),
        ffprobe_adapter=StubOutputProbeAdapter(),
        command_runner=lambda *_args, **_kwargs: None,
    )

    with pytest.raises(MediaAdapterError) as error_info:
        adapter.normalize_audio(outside)

    assert error_info.value.code == "MEDIA_TRANSCODE_FAILED"


def test_normalize_audio_rejects_non_utf8_ffmpeg_version_stdout(tmp_path: Path) -> None:
    input_path = tmp_path / "lesson.wav"
    input_path.write_bytes(b"input")

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"\xff\xfe\xfd", "stderr": b"", "returncode": 0}
        raise AssertionError("transcode command should not run")

    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=True),
        ffprobe_adapter=StubOutputProbeAdapter(),
        command_runner=runner,
        create_output_token=lambda: "11111111-1111-4111-8111-111111111111",
    )

    with pytest.raises(MediaAdapterError) as error_info:
        adapter.normalize_audio(input_path)

    error = error_info.value
    assert error.code == "MEDIA_TRANSCODE_FAILED"
    assert error.__cause__ is None
    assert error.__context__ is None


def test_normalize_audio_maps_partial_stat_error_to_stable_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    input_path = tmp_path / "lesson.wav"
    input_path.write_bytes(b"input")
    partial_path = tmp_path / "normalized-audio" / "11111111-1111-4111-8111-111111111111.wav.partial"
    real_stat = Path.stat

    def runner(args: list[str], **_: object):
        if args[1:] == ["-version"]:
            return {"stdout": b"ffmpeg version 8.1.1\n", "stderr": b"", "returncode": 0}
        _write_wav_file(Path(args[-1]), channels=1, sample_rate=16000, frames=b"\x00\x01" * 300)
        return {"stdout": b"", "stderr": b"", "returncode": 0}

    def fake_stat(self: Path):
        if self == partial_path:
            raise RuntimeError("secret-os-path")
        return real_stat(self)

    monkeypatch.setattr(Path, "stat", fake_stat)
    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=StubInputProbeAdapter(has_audio=True),
        ffprobe_adapter=StubOutputProbeAdapter(),
        command_runner=runner,
        create_output_token=lambda: "11111111-1111-4111-8111-111111111111",
    )

    with pytest.raises(MediaAdapterError) as error_info:
        adapter.normalize_audio(input_path)

    error = error_info.value
    assert error.code == "MEDIA_TRANSCODE_FAILED"
    assert "secret-os-path" not in str(error)
    assert "secret-os-path" not in repr(error)
    assert error.__cause__ is None
    assert error.__context__ is None
    with pytest.raises(FileNotFoundError):
        real_stat(partial_path)
    with pytest.raises(FileNotFoundError):
        real_stat(partial_path.with_suffix(""))
    assert input_path.exists()


def test_ffmpeg_adapter_constructor_maps_workspace_resolve_error_to_stable_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_root = Path("secret-workspace")
    real_resolve = Path.resolve

    def fake_resolve(self: Path, strict: bool = False) -> Path:
        if self == workspace_root:
            raise RuntimeError("secret-os-path")
        return real_resolve(self, strict=strict)

    monkeypatch.setattr(Path, "resolve", fake_resolve)

    with pytest.raises(MediaAdapterError) as error_info:
        FfmpegAdapter(
            workspace_root=workspace_root,
            probe_adapter=StubInputProbeAdapter(has_audio=True),
            ffprobe_adapter=StubOutputProbeAdapter(),
        )

    error = error_info.value
    assert error.code == "MEDIA_TRANSCODE_FAILED"
    assert "secret-os-path" not in str(error)
    assert "secret-os-path" not in repr(error)
    assert error.__cause__ is None
    assert error.__context__ is None


def test_normalize_audio_real_ffmpeg_integration(tmp_path: Path) -> None:
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        pytest.skip("ffmpeg/ffprobe not available")

    input_path = tmp_path / "input.wav"
    _write_wav_file(
        input_path,
        channels=2,
        sample_rate=8000,
        frames=b"\x00\x01\x00\x02" * 800,
    )

    ffprobe_adapter = FfprobeAdapter(workspace_root=tmp_path)
    adapter = FfmpegAdapter(
        workspace_root=tmp_path,
        probe_adapter=ffprobe_adapter,
        ffprobe_adapter=ffprobe_adapter,
    )

    result = adapter.normalize_audio(input_path)
    probed_output = ffprobe_adapter.probe_media(result.local_path, source_kind="audio")

    assert result.local_path.exists()
    assert result.sample_rate == 16000
    assert result.channels == 1
    assert result.codec == "pcm_s16le"
    assert probed_output.streams[0]["audio"]["sampleRate"] == 16000
    assert probed_output.streams[0]["audio"]["channels"] == 1
    assert probed_output.streams[0]["codecName"] == "pcm_s16le"
