// SPDX-License-Identifier: GPL-3.0-or-later
// Independent upstream scalar dense-stack reference, not a board evaluation.
#include "nnue/nnue_architecture.h"
#include <fstream>
#include <iostream>
#include <iterator>
#include <vector>
int main(int argc,char** argv) {
 if(argc!=3)return 64;
 Stockfish::Eval::NNUE::NetworkArchitecture network;
 std::ifstream weights(argv[1],std::ios::binary);
 if(!network.read_parameters(weights) || weights.peek()!=std::char_traits<char>::eof())return 65;
 std::ifstream source(argv[2],std::ios::binary);
 std::vector<unsigned char> input((std::istreambuf_iterator<char>(source)),{});
 if(input.size()!=1024)return 66;
 Stockfish::Eval::NNUE::NNZInfo<1024> nnz{};
 std::cout<<network.propagate(input.data(),nnz)<<"\n";
}
