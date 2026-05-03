-- Lua worker fixture that depends on the parser module.

local parser = require("parser")
local Worker = {}

function Worker:run(input)
    return parser.normalize(input)
end

return Worker