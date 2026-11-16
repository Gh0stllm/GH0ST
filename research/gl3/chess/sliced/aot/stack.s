.text
.globaltype __stack_pointer, i32
.globl proof_stack_pointer
.type proof_stack_pointer,@function
proof_stack_pointer:
  .functype proof_stack_pointer () -> (i32)
  global.get __stack_pointer
  end_function
.globl proof_set_stack_pointer
.type proof_set_stack_pointer,@function
proof_set_stack_pointer:
  .functype proof_set_stack_pointer (i32) -> ()
  local.get 0
  global.set __stack_pointer
  end_function
