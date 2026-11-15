// SPDX-License-Identifier: GPL-3.0-or-later
#include "gh0st_engine.h"
#include <cstring>
#include <memory>
#include <sstream>
#include <string>
#include <vector>
#include "attacks.h"
#include "engine.h"
#include "position.h"
#include "search.h"
#include "tune.h"

namespace {
std::unique_ptr<Stockfish::Engine> engine;
void set_option(Stockfish::OptionsMap& options, const std::string& name, const std::string& value) {
    std::istringstream command("name " + name + " value " + value);
    options.setoption(command);
}
Stockfish::Engine& get_engine() {
    if (!engine) {
        Stockfish::Attacks::init();
        Stockfish::Position::init();
        engine = std::make_unique<Stockfish::Engine>();
        Stockfish::Tune::init(engine->get_options());
        auto& options = engine->get_options();
        options.add_info_listener([](std::optional<std::string>) {});
        set_option(options, "NumaPolicy", "none");
        set_option(options, "Threads", "1");
        set_option(options, "Skill Level", "20");
        set_option(options, "UCI_LimitStrength", "false");
        set_option(options, "MultiPV", "1");
        set_option(options, "Ponder", "false");
        set_option(options, "SyzygyPath", "");
        engine->set_on_verify_network([](std::string_view) {});
        engine->set_on_update_no_moves([](const Stockfish::Engine::InfoShort&) {});
        engine->set_on_iter([](const Stockfish::Engine::InfoIter&) {});
        engine->set_on_start([]() {});
    }
    return *engine;
}
}

extern "C" const char* gh0st_stockfish_commit(void) {
    return "edb0d9db6731067ec50ce619ff372b463bc4dd5d";
}
extern "C" const char* gh0st_stockfish_nnue_sha256(void) {
    return "1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2";
}
extern "C" int gh0st_stockfish_search_history(
    const char* fen, const char* moves_text, uint64_t nodes, uint32_t hash_mb,
    char* out, size_t cap, uint64_t* actual_nodes, uint32_t* depth_out) {
    if (!fen || !moves_text || !out || cap < 6 || !actual_nodes || !depth_out
        || std::strlen(fen) > 128 || std::strlen(moves_text) > 8192
        || nodes == 0 || hash_mb == 0 || hash_mb > 1024)
        return 1;
    out[0] = '\0';
    *actual_nodes = 0;
    *depth_out = 0;
    std::vector<std::string> moves;
    std::istringstream input(moves_text);
    for (std::string move; input >> move;) {
        if (move.size() < 4 || move.size() > 5 || moves.size() >= 1024)
            return 1;
        moves.push_back(move);
    }
    auto& e = get_engine();
    set_option(e.get_options(), "Hash", std::to_string(hash_mb));
    e.search_clear();
    if (e.set_position(fen, moves))
        return 2;
    std::string best;
    e.set_on_bestmove([&](std::string_view move, std::string_view) { best = move; });
    e.set_on_update_full([&](const Stockfish::Engine::InfoFull& info) {
        *actual_nodes = info.nodes;
        *depth_out = static_cast<uint32_t>(info.depth);
    });
    Stockfish::Search::LimitsType limits;
    limits.nodes = nodes;
    limits.startTime = 0;
    e.go(limits);
    e.wait_for_search_finished();
    // Callback references must never survive this invocation.
    e.set_on_bestmove([](std::string_view, std::string_view) {});
    e.set_on_update_full([](const Stockfish::Engine::InfoFull&) {});
    if (best.empty() || best == "(none)" || best == "0000")
        return 3;
    if (best.size() + 1 > cap)
        return 4;
    std::memcpy(out, best.c_str(), best.size() + 1);
    return 0;
}
extern "C" int gh0st_stockfish_search(
    const char* fen, uint64_t nodes, uint32_t hash_mb, char* out, size_t cap,
    uint64_t* actual_nodes, uint32_t* depth_out) {
    return gh0st_stockfish_search_history(fen, "", nodes, hash_mb, out, cap,
                                          actual_nodes, depth_out);
}
