	.globaltype __stack_pointer, i32
	.functype gh0st_engine_thunk () -> ()
	.section .text.gh0st_call_on_engine_stack,"",@
	.globl gh0st_call_on_engine_stack
	.type gh0st_call_on_engine_stack,@function
gh0st_call_on_engine_stack:
	.functype gh0st_call_on_engine_stack (i32) -> ()
	.local i32
	global.get __stack_pointer
	local.set 1
	local.get 0
	global.set __stack_pointer
	call gh0st_engine_thunk
	local.get 1
	global.set __stack_pointer
	end_function

	.section .text.gh0st_current_stack_pointer,"",@
	.globl gh0st_current_stack_pointer
	.type gh0st_current_stack_pointer,@function
gh0st_current_stack_pointer:
	.functype gh0st_current_stack_pointer () -> (i32)
	global.get __stack_pointer
	end_function
