-- Lua parser fixture focused on token normalization.

local Parser = {}

function Parser.normalize(input)
    return input:gsub("^%s+", ""):gsub("%s+$", ""):lower()
end

return Parser