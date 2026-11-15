import unittest
import chess
from run_matches import terminal

class Adjudication(unittest.TestCase):
    def play(self, moves):
        board = chess.Board()
        for move in moves.split(): board.push_uci(move)
        return board
    def test_white_legal_checkmate(self):
        board = self.play('e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7')
        self.assertEqual(terminal(board), ('1-0','checkmate',None))
    def test_black_legal_checkmate(self):
        board = self.play('f2f3 e7e5 g2g4 d8h4')
        self.assertEqual(terminal(board), ('0-1','checkmate',None))
    def test_mate_precedes_move_clock(self):
        board = chess.Board('k7/1Q6/2K5/8/8/8/8/8 b - - 150 76')
        self.assertEqual(terminal(board), ('1-0','checkmate',None))
    def test_stalemate_is_draw(self):
        self.assertEqual(terminal(chess.Board('k7/8/1QK5/8/8/8/8/8 b - - 0 1')),
                         ('1/2-1/2','stalemate',None))
    def test_current_repetition_claim(self):
        board = self.play('g1f3 g8f6 f3g1 f6g8 '*2+'g1f3')
        self.assertEqual(terminal(board),('1/2-1/2','claimed_threefold_current',None))
    def test_fivefold_precedes_optional_claim(self):
        board = self.play('g1f3 g8f6 f3g1 f6g8 '*4)
        self.assertEqual(terminal(board),('1/2-1/2','fivefold_repetition',None))
    def test_white_declines_current_optional_draw(self):
        board = self.play('g1f3 g8f6 f3g1 f6g8 '*2)
        self.assertTrue(board.is_repetition(3))
        self.assertIsNone(terminal(board))
    def test_no_engine_score_or_resource_draw(self):
        self.assertIsNone(terminal(chess.Board()))
    def test_current_fifty_move_claim(self):
        self.assertEqual(terminal(chess.Board('k7/8/8/8/8/8/7R/7K b - - 100 51')),
                         ('1/2-1/2','claimed_fifty_moves_current',None))
    def test_automatic_seventyfive(self):
        self.assertEqual(terminal(chess.Board('k7/8/8/8/8/8/7R/7K w - - 150 76')),
                         ('1/2-1/2','seventy_five_moves',None))
    def test_white_declines_optional_repetition_claim(self):
        board = self.play('b1c3 b8c6 c3b1 c6b8 b1c3 b8c6 c3a4 c6b8')
        self.assertTrue(board.can_claim_threefold_repetition())
        self.assertIsNone(terminal(board))

if __name__ == '__main__': unittest.main()
