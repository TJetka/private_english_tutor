"""Audit the existing JS with synthetic data; known defects are strict xfails.

Node executes the trusted repository source with a fixed date and RNG seed 42.
Storage, DOM and HTTP are mocked; these checks do not certify a live deployment.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.fixture(scope="module")
def audit() -> dict:
    """Run the isolated scenarios once and return their JSON observations."""
    node = shutil.which("node")
    if node is None:
        pytest.fail("Node.js is required for the JavaScript audit")
    result = subprocess.run(
        [node, str(Path(__file__).with_name("audit_scenarios.cjs"))],
        capture_output=True,
        text=True,
        check=True,
        timeout=15,
    )
    return json.loads(result.stdout)


def test_content_schema_and_ids(audit: dict) -> None:
    assert audit["content"] == {
        "weeks": 2,
        "words": 34,
        "sentences": 11,
        "uniqueIds": True,
        "validGaps": True,
    }


def test_fresh_session_has_new_words_and_grammar(audit: dict) -> None:
    assert audit["freshSession"] == {
        "length": 14,
        "words": 5,
        "sentences": 4,
        "validOptions": True,
    }


def test_session_smoke_saves_progress_and_backup(audit: dict) -> None:
    result = audit["smoke"]
    assert result["xp"] == result["expectedXp"] == 140
    assert result["days"] == result["streak"] == 1
    assert result["itemSchema"] and result["backup"]


def test_partial_session_is_saved_locally(audit: dict) -> None:
    assert audit["partialSession"]["saved"]


@pytest.mark.xfail(
    strict=True, reason="L1: final slice removes all grammar on busy review days"
)
def test_crowded_session_retains_grammar(audit: dict) -> None:
    assert audit["crowdedSession"]["sentences"] >= 4


@pytest.mark.xfail(
    strict=True, reason="L2: immediate repetitions can unlock week 2 in one day"
)
def test_week_progression_requires_delayed_recall(audit: dict) -> None:
    assert audit["sameDayProgression"]["days"] == 1
    assert audit["sameDayProgression"]["week"] == 1


@pytest.mark.xfail(
    strict=True, reason="S1: pull drops dirty flag before boot can upload"
)
def test_boot_uploads_pending_local_progress(audit: dict) -> None:
    assert audit["pendingSync"]["uploaded"]


@pytest.mark.xfail(
    strict=True, reason="S2: joining a different key retains old learner data"
)
def test_joining_profile_does_not_mix_learners(audit: dict) -> None:
    assert not audit["profileSwitch"]["oldItemsRetained"]
    assert audit["profileSwitch"]["remoteName"]


@pytest.mark.xfail(
    strict=True, reason="S3: stale PUT acknowledgement replaces newer answers"
)
def test_in_flight_sync_preserves_new_answer(audit: dict) -> None:
    assert audit["inFlightSync"]["xp"] == 10
    assert audit["inFlightSync"]["recorded"]


@pytest.mark.xfail(strict=True, reason="S4: max counters discard independent practice")
def test_merge_preserves_independent_practice(audit: dict) -> None:
    result = audit["merge"]
    assert result["xp"] == result["expectedXp"]
    assert result["attempts"] == result["expectedAttempts"]


@pytest.mark.xfail(
    strict=True, reason="S4: equal-attempt item merge depends on argument order"
)
def test_item_merge_is_order_independent(audit: dict) -> None:
    assert audit["merge"]["orderIndependent"]


@pytest.mark.xfail(
    strict=True, reason="S5: individual answers do not mark progress for upload"
)
def test_partial_session_is_marked_for_sync(audit: dict) -> None:
    assert audit["partialSession"]["dirty"]


@pytest.mark.xfail(
    strict=True, reason="S6: successful HTTP with invalid JSON clears dirty"
)
def test_invalid_ack_is_not_treated_as_saved(audit: dict) -> None:
    assert not audit["invalidAck"]["accepted"]
