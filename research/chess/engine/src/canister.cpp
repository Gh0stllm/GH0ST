// SPDX-License-Identifier: GPL-3.0-or-later
#include "ic_api.h"
#include "wasm_symbol.h"
#include "gh0st_engine.h"
#include <string>
#include <vector>

extern "C" uint64_t gh0st_instruction_counter(uint32_t)
  __attribute__((import_module("ic0"), import_name("performance_counter")));

void engine_init() WASM_SYMBOL_EXPORTED("canister_init");
void engine_post_upgrade() WASM_SYMBOL_EXPORTED("canister_post_upgrade");
void search() WASM_SYMBOL_EXPORTED("canister_update search");
void identity() WASM_SYMBOL_EXPORTED("canister_query identity");

namespace {
std::string authority;
std::vector<uint8_t> committed_config;
uint64_t committed_nodes{};
uint32_t committed_hash_mb{};

void configure(IC_API& ic) {
    CandidArgs args;
    args.append(CandidTypeText{&authority});
    args.append(CandidTypeVecNat8{&committed_config});
    args.append(CandidTypeNat64{&committed_nodes});
    args.append(CandidTypeNat32{&committed_hash_mb});
    ic.from_wire(args);
    // No default authority or default paid-game configuration.
    CandidTypePrincipal principal(authority);
    if (principal.is_anonymous() || authority.empty() || committed_config.size() != 32
        || committed_nodes == 0 || committed_nodes > 100000000
        || committed_hash_mb == 0 || committed_hash_mb > 1024)
        IC_API::trap("invalid engine configuration");
}
void error(IC_API& ic, const std::string& message) {
    ic.to_wire(CandidTypeVariant{"Err", CandidTypeText{message}});
}
}

void engine_init() {
    IC_API ic(CanisterInit{std::string(__func__)}, false);
    configure(ic);
}
void engine_post_upgrade() {
    IC_API ic(CanisterPostUpgrade{std::string(__func__)}, false);
    configure(ic);
}
void identity() {
    IC_API ic(CanisterQuery{std::string(__func__)}, false);
    CandidTypeRecord result;
    result.append("engine_commit", CandidTypeText{gh0st_stockfish_commit()});
    result.append("nnue_sha256", CandidTypeText{gh0st_stockfish_nnue_sha256()});
    result.append("config_hash", CandidTypeVecNat8{committed_config});
    result.append("nodes", CandidTypeNat64{committed_nodes});
    result.append("hash_mb", CandidTypeNat32{committed_hash_mb});
    result.append("authority", CandidTypeText{authority});
    ic.to_wire(result);
}
void search() {
    IC_API ic(CanisterUpdate{std::string(__func__)}, false);
    if (authority.empty() || ic.get_caller().get_text() != authority) {
        error(ic, "unauthorized authority");
        return;
    }
    std::vector<uint8_t> job, config;
    std::string fen;
    std::vector<std::string> moves;
    uint64_t nodes{};
    uint32_t hash_mb{};
    CandidTypeRecord request;
    request.append("job_id", CandidTypeVecNat8{&job});
    request.append("config_hash", CandidTypeVecNat8{&config});
    request.append("initial_fen", CandidTypeText{&fen});
    request.append("moves", CandidTypeVecText{&moves});
    request.append("nodes", CandidTypeNat64{&nodes});
    request.append("hash_mb", CandidTypeNat32{&hash_mb});
    ic.from_wire(request);
    if (job.size() != 32 || config != committed_config || nodes != committed_nodes
        || hash_mb != committed_hash_mb || moves.size() > 1024) {
        error(ic, "request does not match committed configuration");
        return;
    }
    std::string history;
    for (const auto& move : moves) {
        if (move.size() < 4 || move.size() > 5 || move.find_first_of(" \t\r\n") != std::string::npos) {
            error(ic, "invalid UCI move encoding");
            return;
        }
        if (!history.empty()) history += ' ';
        history += move;
    }
    char bestmove[8]{};
    uint64_t actual{};
    uint32_t depth{};
    int code = gh0st_stockfish_search_history(fen.c_str(), history.c_str(), nodes,
        hash_mb, bestmove, sizeof(bestmove), &actual, &depth);
    if (code != 0) {
        error(ic, "Stockfish fault " + std::to_string(code));
        return;
    }
    const std::string stop_reason = actual >= nodes ? "node_budget"
      : (actual > 0 && depth == 245 ? "max_depth" : "");
    if (stop_reason.empty()) {
        error(ic, "Stockfish stopped below the committed budget");
        return;
    }
    CandidTypeRecord response;
    response.append("job_id", CandidTypeVecNat8{job});
    response.append("config_hash", CandidTypeVecNat8{config});
    response.append("bestmove", CandidTypeText{bestmove});
    response.append("actual_nodes", CandidTypeNat64{actual});
    response.append("depth", CandidTypeNat32{depth});
    response.append("stop_reason", CandidTypeText{stop_reason});
    response.append("engine_commit", CandidTypeText{gh0st_stockfish_commit()});
    response.append("nnue_sha256", CandidTypeText{gh0st_stockfish_nnue_sha256()});
    response.append("instructions", CandidTypeNat64{gh0st_instruction_counter(0)});
    ic.to_wire(CandidTypeVariant{"Ok", response});
}
