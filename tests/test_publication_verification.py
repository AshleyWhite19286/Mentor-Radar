"""Regression fixtures for actual publisher metadata failure modes; no network."""
import importlib
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'scripts'))
completion = importlib.import_module('complete-publications')
crossref_authors = importlib.import_module('enrich-crossref-authors')


class PublicationVerificationTest(unittest.TestCase):
    def test_identical_commentary_title_without_teacher_is_rejected(self):
        title = 'ROFI: a deep learning-based ophthalmic sign-preserving and reversible patient face anonymizer'
        article = {'title': [title], 'DOI': '10.1097/ms9.0000000000004558', 'author': [{'given': 'Erum', 'family': 'Habib'}, {'given': 'Fatima', 'family': 'Hajj'}], 'published': {'date-parts': [[2026, 1, 22]]}}
        self.assertIsNone(completion.crossref_paper(article, {'name': '陈一彤'}, {'line': title, 'url': 'https://example.com/official'}))

    def test_publisher_teacher_name_and_original_date_precision_are_retained(self):
        title = 'All-optical synthesis chip for large-scale intelligent semantic vision generation'
        article = {'title': [title], 'DOI': '10.example/fixture', 'author': [{'given': 'Yitong', 'family': 'Chen'}], 'published': {'date-parts': [[2025, 12]]}}
        paper = completion.crossref_paper(article, {'name': '陈一彤'}, {'line': title, 'url': 'https://example.com/official'})
        self.assertEqual(paper['date'], '2025-12')
        self.assertEqual(paper['precision'], 'month')

    def test_department_in_separate_publisher_field_is_not_lost(self):
        author = {'affiliation': [{'name': 'Shanghai Jiao Tong University', 'department': ['Department of Electronic Engineering'], 'place': ['Shanghai, China']}]}
        text = crossref_authors.affiliation_text(author)
        self.assertIn('Shanghai Jiao Tong University', text)
        self.assertIn('Department of Electronic Engineering', text)

    def test_same_family_name_with_different_full_given_name_is_rejected(self):
        self.assertFalse(completion.crossref_author_matches({'author': [{'given': 'Yun', 'family': 'Chen'}]}, {'name': '陈一彤'}))


if __name__ == '__main__':
    unittest.main()
