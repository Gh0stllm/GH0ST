"""Runpod-only launch-gate regressions; no engine or chain execution."""
import copy
import unittest

from acceptance_guards import (
    AcceptanceError, SELECTED_ROOT, validate_cache_integration_review,
    validate_final_host_authorization,
)


class HostCompositionBinding(unittest.TestCase):
    def setUp(self):
        self.candidate = "a" * 64
        self.review = {
            "passed": True, "hostCandidateManifestSHA256": self.candidate,
            "independentIntegrationPassed": True, "boundedRealPrefixPassed": True,
            "authenticMemoReusePassed": True, "allExecutionOnRunpod": True,
            "enginePolicyChanged": False, "moduleRoot": SELECTED_ROOT,
        }
        self.expected = {
            "binarySHA256": "1" * 64, "compiledInputsSHA256": "2" * 64,
            "controllerSHA256": "3" * 64,
            "hostCandidateManifestSHA256": self.candidate,
            "cacheIntegrationReviewSHA256": "5" * 64,
        }
        self.authorization = dict(
            self.expected, authorized=True,
            scope="PRIVATE_SELECTED_865_GEOMETRY43_LIFECYCLE_ONLY",
        )

    def test_complete_private_composition(self):
        validate_cache_integration_review(self.review, self.candidate)
        validate_final_host_authorization(self.authorization, self.expected)

    def test_old_candidate_review_rejected(self):
        with self.assertRaises(AcceptanceError):
            validate_cache_integration_review(self.review, "b" * 64)

    def test_every_cache_gate_is_required(self):
        for field in ["passed", "independentIntegrationPassed", "boundedRealPrefixPassed",
                      "authenticMemoReusePassed", "allExecutionOnRunpod"]:
            for value in [False, 1, "true", None]:
                with self.subTest(field=field, value=value):
                    review = copy.deepcopy(self.review)
                    review[field] = value
                    with self.assertRaises(AcceptanceError):
                        validate_cache_integration_review(review, self.candidate)

    def test_other_machine_or_strength_rejected(self):
        for field, value in [("moduleRoot", "0x" + "0" * 64),
                             ("enginePolicyChanged", True),
                             ("enginePolicyChanged", None)]:
            review = dict(self.review)
            review[field] = value
            with self.subTest(field=field, value=value):
                with self.assertRaises(AcceptanceError):
                    validate_cache_integration_review(review, self.candidate)

    def test_each_stale_final_binding_rejected(self):
        for field in self.expected:
            with self.subTest(field=field):
                authorization = dict(self.authorization)
                authorization[field] = "f" * 64
                with self.assertRaises(AcceptanceError):
                    validate_final_host_authorization(authorization, self.expected)

    def test_missing_or_unknown_final_binding_rejected(self):
        for field in self.expected:
            expected = dict(self.expected)
            del expected[field]
            with self.subTest(field=field):
                with self.assertRaises(AcceptanceError):
                    validate_final_host_authorization(self.authorization, expected)
        expected = dict(self.expected, otherSHA256="f" * 64)
        with self.assertRaises(AcceptanceError):
            validate_final_host_authorization(self.authorization, expected)

    def test_scope_and_authority_rejected(self):
        for field, value in [("authorized", False), ("authorized", 1),
                             ("scope", "MAINNET"), ("scope", None)]:
            authorization = dict(self.authorization)
            authorization[field] = value
            with self.subTest(field=field, value=value):
                with self.assertRaises(AcceptanceError):
                    validate_final_host_authorization(authorization, self.expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
