#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Full-strength Stockfish 19; single worker; cleared histories/TT per decision.
 * 0 = success, 1 = invalid argument, 2 = illegal position/history,
 * 3 = no legal move, 4 = output buffer too small. Never substitute another bot.
 * The history entry point is required for paid games to preserve repetition.
 */
int gh0st_stockfish_search(const char* fen, uint64_t nodes, uint32_t hash_mb,
                          char* bestmove_out, size_t bestmove_cap,
                          uint64_t* actual_nodes, uint32_t* depth_out);
int gh0st_stockfish_search_history(const char* initial_fen, const char* uci_moves,
                                  uint64_t nodes, uint32_t hash_mb,
                                  char* bestmove_out, size_t bestmove_cap,
                                  uint64_t* actual_nodes, uint32_t* depth_out);
const char* gh0st_stockfish_commit(void);
const char* gh0st_stockfish_nnue_sha256(void);
#ifdef __cplusplus
}
#endif
