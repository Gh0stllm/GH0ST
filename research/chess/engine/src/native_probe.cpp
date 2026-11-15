// SPDX-License-Identifier: GPL-3.0-or-later
#include "gh0st_engine.h"
#include <cstdlib>
#include <iostream>
int main(int argc, char** argv) {
    if (argc < 4 || argc > 6) return 64;
    char move[8]{};
    uint64_t actual{};
    uint32_t depth{};
    const int repeats = argc == 6 ? std::atoi(argv[5]) : 1;
    int result = 0;
    for (int i = 0; i < repeats; ++i) {
    result = gh0st_stockfish_search_history(argv[1], argc >= 5 ? argv[4] : "",
        std::strtoull(argv[2], nullptr, 10), std::strtoul(argv[3], nullptr, 10),
        move, sizeof(move), &actual, &depth);
    std::cout << "{\"status\":" << result << ",\"bestmove\":\"" << move
              << "\",\"actual_nodes\":" << actual << ",\"depth\":" << depth << "}\n";
    }
    return result;
}
