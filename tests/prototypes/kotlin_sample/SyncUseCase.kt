/* Kotlin use case fixture used to validate semantic symbol extraction. */

class SyncUseCase {
    fun execute(input: String): String {
        return normalize(input)
    }
}

fun normalize(input: String): String {
    return input.trim().lowercase()
}